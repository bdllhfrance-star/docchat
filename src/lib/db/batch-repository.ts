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
import { canTransitionDocumentStatus } from "@/lib/documents/status";
import { createBlobPathname } from "@/lib/uploads/blob-contract";
import type {
  BatchStatus,
  ChunkRecord,
  DocumentStatus,
} from "@/types/documents";
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
  countDocuments(filter: Filter<T>): Promise<number>;
};

export type BatchRepositoryCollections = {
  batches: CollectionPort<BatchRecord>;
  documents: CollectionPort<DocumentRecord>;
  chunks: CollectionPort<ChunkRecord>;
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

export type CompleteDocumentIndexing = DocumentOwnership & {
  chunks: ChunkRecord[];
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

function getBatchStatus(
  totalFiles: number,
  readyFiles: number,
  failedFiles: number,
): BatchStatus {
  if (readyFiles + failedFiles < totalFiles) {
    return "processing";
  }

  if (readyFiles === totalFiles) {
    return "ready";
  }

  return readyFiles > 0 ? "partial" : "failed";
}

async function refreshBatchProgress(
  collections: BatchRepositoryCollections,
  ownership: Pick<DocumentOwnership, "sessionId" | "batchId">,
): Promise<void> {
  const batchFilter = {
    sessionId: ownership.sessionId,
    id: ownership.batchId,
  } satisfies Filter<BatchRecord>;
  const batch = await collections.batches.findOne(batchFilter);

  if (!batch) {
    throw new Error("Batch not found while refreshing progress");
  }

  const documentFilter = {
    sessionId: ownership.sessionId,
    batchId: ownership.batchId,
  };
  const [readyFiles, failedFiles] = await Promise.all([
    collections.documents.countDocuments({
      ...documentFilter,
      status: "ready",
    }),
    collections.documents.countDocuments({
      ...documentFilter,
      status: "failed",
    }),
  ]);

  await collections.batches.updateOne(batchFilter, {
    $set: {
      readyFiles,
      failedFiles,
      status: getBatchStatus(batch.totalFiles, readyFiles, failedFiles),
    },
  });
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

      await refreshBatchProgress(collections, failure);

      return transitioned?.status === "failed" &&
        hasSameFailure(transitioned, failure.error)
        ? transitioned
        : null;
    },

    async transitionDocumentStatus(
      ownership: DocumentOwnership,
      from: DocumentStatus,
      to: DocumentStatus,
    ): Promise<DocumentRecord | null> {
      if (!canTransitionDocumentStatus(from, to)) {
        throw new Error(`Invalid document status transition: ${from} -> ${to}`);
      }

      const ownershipFilter = {
        sessionId: ownership.sessionId,
        batchId: ownership.batchId,
        id: ownership.documentId,
      } satisfies Filter<DocumentRecord>;
      const result = await collections.documents.updateOne(
        { ...ownershipFilter, status: from },
        { $set: { status: to }, $unset: { error: "" } },
      );

      if (result.matchedCount !== 1) {
        return null;
      }

      return collections.documents.findOne(ownershipFilter);
    },

    async failDocumentProcessing(
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

      if (!canTransitionDocumentStatus(current.status, "failed")) {
        return null;
      }

      const result = await collections.documents.updateOne(
        { ...ownershipFilter, status: current.status },
        { $set: { status: "failed", error: failure.error } },
      );

      if (result.matchedCount !== 1) {
        return null;
      }

      await refreshBatchProgress(collections, failure);

      return collections.documents.findOne(ownershipFilter);
    },

    async completeDocumentIndexing(
      completion: CompleteDocumentIndexing,
    ): Promise<DocumentRecord | null> {
      if (completion.chunks.length === 0) {
        throw new Error("A ready document must contain at least one chunk");
      }

      const ownershipFilter = {
        sessionId: completion.sessionId,
        batchId: completion.batchId,
        id: completion.documentId,
      } satisfies Filter<DocumentRecord>;

      for (const chunk of completion.chunks) {
        if (
          chunk.sessionId !== completion.sessionId ||
          chunk.batchId !== completion.batchId ||
          chunk.documentId !== completion.documentId
        ) {
          throw new Error("Chunk ownership does not match its document");
        }
      }

      const chunkFilter = {
        sessionId: completion.sessionId,
        batchId: completion.batchId,
        documentId: completion.documentId,
      } satisfies Filter<ChunkRecord>;

      await collections.chunks.deleteMany(chunkFilter);

      try {
        await collections.chunks.insertMany(completion.chunks);
      } catch (error) {
        await collections.chunks.deleteMany(chunkFilter);
        throw error;
      }

      const result = await collections.documents.updateOne(
        { ...ownershipFilter, status: "indexing" },
        { $set: { status: "ready" }, $unset: { error: "" } },
      );

      if (result.matchedCount !== 1) {
        await collections.chunks.deleteMany(chunkFilter);
        return null;
      }

      await refreshBatchProgress(collections, completion);

      return collections.documents.findOne(ownershipFilter);
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
  const chunks = database.collection<ChunkRecord>(databaseCollectionNames.chunks);

  return createBatchRepository({
    batches,
    documents,
    chunks,
  });
}
