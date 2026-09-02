import type {
  DeleteResult,
  Filter,
  InsertManyResult,
  InsertOneResult,
  UpdateFilter,
  UpdateResult,
} from "mongodb";

import { getDatabase } from "@/lib/db/client";
import { databaseCollectionNames } from "@/lib/db/indexes";
import { createBlobPathname } from "@/lib/uploads/blob-contract";
import type {
  BatchRecord,
  CreatedBatch,
  DocumentRecord,
} from "@/types/persistence";

type CollectionPort<T extends object> = {
  insertOne(document: T): Promise<InsertOneResult<T>>;
  insertMany(documents: T[]): Promise<InsertManyResult<T>>;
  findOne(filter: Filter<T>): Promise<T | null>;
  updateOne(
    filter: Filter<T>,
    update: UpdateFilter<T>,
  ): Promise<UpdateResult<T>>;
  deleteOne(filter: Filter<T>): Promise<DeleteResult>;
  deleteMany(filter: Filter<T>): Promise<DeleteResult>;
};

export type BatchRepositoryCollections = {
  batches: CollectionPort<BatchRecord>;
  documents: CollectionPort<DocumentRecord>;
};

export type DocumentOwnership = {
  sessionId: string;
  batchId: string;
  documentId: string;
};

export type CompleteDocumentUpload = DocumentOwnership & {
  blobUrl: string;
};

export type FailDocumentUpload = DocumentOwnership & {
  error: NonNullable<DocumentRecord["error"]>;
};

function hasSameFailure(
  document: DocumentRecord,
  error: NonNullable<DocumentRecord["error"]>,
): boolean {
  return (
    document.error?.code === error.code &&
    document.error.message === error.message
  );
}

function normalizeCreatedBatch(createdBatch: CreatedBatch): CreatedBatch {
  return {
    batch: createdBatch.batch,
    documents: createdBatch.documents.map((document) => ({
      ...document,
      blobPathname: createBlobPathname(
        createdBatch.batch.id,
        document.id,
        document.fileType,
      ),
    })),
  };
}

function assertCreatedBatchOwnership(createdBatch: CreatedBatch): void {
  if (createdBatch.batch.totalFiles !== createdBatch.documents.length) {
    throw new Error("Batch file count does not match its documents");
  }

  for (const document of createdBatch.documents) {
    if (
      document.sessionId !== createdBatch.batch.sessionId ||
      document.batchId !== createdBatch.batch.id
    ) {
      throw new Error("Document ownership does not match its batch");
    }
  }
}

async function compensateBatchCreation(
  collections: BatchRepositoryCollections,
  batch: BatchRecord,
): Promise<unknown[]> {
  const cleanupResults = await Promise.allSettled([
    collections.documents.deleteMany({
      sessionId: batch.sessionId,
      batchId: batch.id,
    }),
    collections.batches.deleteOne({
      sessionId: batch.sessionId,
      id: batch.id,
    }),
  ]);

  return cleanupResults.flatMap((result) =>
    result.status === "rejected" ? [result.reason] : [],
  );
}

export function createBatchRepository(
  collections: BatchRepositoryCollections,
) {
  return {
    async createBatch(createdBatch: CreatedBatch): Promise<CreatedBatch> {
      assertCreatedBatchOwnership(createdBatch);
      const normalizedBatch = normalizeCreatedBatch(createdBatch);

      await collections.batches.insertOne(normalizedBatch.batch);

      try {
        await collections.documents.insertMany(normalizedBatch.documents);
      } catch (creationError) {
        const cleanupErrors = await compensateBatchCreation(
          collections,
          normalizedBatch.batch,
        );

        if (cleanupErrors.length > 0) {
          throw new AggregateError(
            [creationError, ...cleanupErrors],
            "Batch creation and compensation failed",
          );
        }

        throw creationError;
      }

      return normalizedBatch;
    },

    findBatchBySession(
      sessionId: string,
      batchId: string,
    ): Promise<BatchRecord | null> {
      return collections.batches.findOne({ sessionId, id: batchId });
    },

    findDocumentBySession(
      sessionId: string,
      batchId: string,
      documentId: string,
    ): Promise<DocumentRecord | null> {
      return collections.documents.findOne({
        sessionId,
        batchId,
        id: documentId,
      });
    },

    async markDocumentUploading(
      ownership: DocumentOwnership,
    ): Promise<DocumentRecord | null> {
      const ownershipFilter = {
        sessionId: ownership.sessionId,
        batchId: ownership.batchId,
        id: ownership.documentId,
      } satisfies Filter<DocumentRecord>;
      const current = await collections.documents.findOne(ownershipFilter);

      if (!current) {
        return null;
      }

      if (current.status === "uploading") {
        return current;
      }

      if (current.status !== "queued") {
        return null;
      }

      await collections.documents.updateOne(
        { ...ownershipFilter, status: "queued" },
        { $set: { status: "uploading" }, $unset: { error: "" } },
      );

      const transitioned = await collections.documents.findOne(ownershipFilter);

      return transitioned?.status === "uploading" ? transitioned : null;
    },

    async completeDocumentUpload(
      upload: CompleteDocumentUpload,
    ): Promise<DocumentRecord | null> {
      const ownershipFilter = {
        sessionId: upload.sessionId,
        batchId: upload.batchId,
        id: upload.documentId,
      } satisfies Filter<DocumentRecord>;
      const current = await collections.documents.findOne(ownershipFilter);

      if (!current) {
        return null;
      }

      if (
        current.blobUrl === upload.blobUrl &&
        current.status !== "queued" &&
        current.status !== "uploading"
      ) {
        return current;
      }

      if (current.status !== "uploading" && current.status !== "failed") {
        return null;
      }

      await collections.documents.updateOne(
        { ...ownershipFilter, status: current.status },
        {
          $set: {
            status: "validating",
            blobUrl: upload.blobUrl,
          },
          $unset: { error: "" },
        },
      );

      const transitioned = await collections.documents.findOne(ownershipFilter);

      return transitioned?.blobUrl === upload.blobUrl &&
        transitioned.status !== "queued" &&
        transitioned.status !== "uploading"
        ? transitioned
        : null;
    },

    async failDocumentUpload(
      failure: FailDocumentUpload,
    ): Promise<DocumentRecord | null> {
      const ownershipFilter = {
        sessionId: failure.sessionId,
        batchId: failure.batchId,
        id: failure.documentId,
      } satisfies Filter<DocumentRecord>;
      const current = await collections.documents.findOne(ownershipFilter);

      if (!current) {
        return null;
      }

      if (current.status === "failed") {
        return hasSameFailure(current, failure.error) ? current : null;
      }

      if (current.status !== "uploading") {
        return null;
      }

      await collections.documents.updateOne(
        { ...ownershipFilter, status: "uploading" },
        {
          $set: {
            status: "failed",
            error: failure.error,
          },
        },
      );

      const transitioned = await collections.documents.findOne(ownershipFilter);

      return transitioned?.status === "failed" &&
        hasSameFailure(transitioned, failure.error)
        ? transitioned
        : null;
    },
  };
}

export async function getBatchRepository() {
  const database = await getDatabase();
  const batches = database.collection<BatchRecord>(
    databaseCollectionNames.batches,
  );
  const documents = database.collection<DocumentRecord>(
    databaseCollectionNames.documents,
  );

  return createBatchRepository({
    batches,
    documents,
  });
}
