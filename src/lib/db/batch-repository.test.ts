import type {
  DeleteResult,
  Filter,
  InsertManyResult,
  InsertOneResult,
  UpdateFilter,
  UpdateResult,
} from "mongodb";
import { describe, expect, test } from "vitest";

import {
  createBatchRepository,
  type BatchRepositoryCollections,
} from "@/lib/db/batch-repository";
import type {
  BatchRecord,
  CreatedBatch,
  DocumentRecord,
} from "@/types/persistence";

const sessionA = "271bf840-1fed-443d-86fb-a82b0bd70465";
const sessionB = "75f9d4bc-c530-43dd-a30f-91dad3ab8ff4";
const batchId = "5f36e79a-30b9-4866-9157-524d7de72af3";
const documentId = "e267df76-9b0e-4616-b187-0252faf57880";
const createdAt = new Date("2026-09-02T08:00:00.000Z");
const expiresAt = new Date("2026-09-09T08:00:00.000Z");

function matches<T extends object>(record: T, filter: Filter<T>): boolean {
  return Object.entries(filter).every(([key, expected]) => {
    if (key.startsWith("$")) {
      throw new Error(`Unsupported test filter: ${key}`);
    }

    return record[key as keyof T] === expected;
  });
}

function applyUpdate<T extends object>(record: T, update: UpdateFilter<T>): void {
  if (update.$set) {
    Object.assign(record, update.$set);
  }

  if (update.$unset) {
    for (const key of Object.keys(update.$unset)) {
      delete record[key as keyof T];
    }
  }
}

class MemoryCollection<T extends object> {
  records: T[] = [];
  failAfterInsertMany = false;
  updateCount = 0;

  async insertOne(document: T): Promise<InsertOneResult<T>> {
    this.records.push(structuredClone(document));
    return { acknowledged: true, insertedId: "test-id" } as never;
  }

  async insertMany(documents: T[]): Promise<InsertManyResult<T>> {
    this.records.push(...structuredClone(documents));

    if (this.failAfterInsertMany) {
      throw new Error("simulated document insert failure");
    }

    return {
      acknowledged: true,
      insertedCount: documents.length,
      insertedIds: {},
    } as never;
  }

  async findOne(filter: Filter<T>): Promise<T | null> {
    return this.records.find((record) => matches(record, filter)) ?? null;
  }

  async updateOne(
    filter: Filter<T>,
    update: UpdateFilter<T>,
  ): Promise<UpdateResult<T>> {
    const record = this.records.find((candidate) => matches(candidate, filter));

    if (!record) {
      return { acknowledged: true, matchedCount: 0, modifiedCount: 0 } as never;
    }

    applyUpdate(record, update);
    this.updateCount += 1;

    return { acknowledged: true, matchedCount: 1, modifiedCount: 1 } as never;
  }

  async deleteOne(filter: Filter<T>): Promise<DeleteResult> {
    const index = this.records.findIndex((record) => matches(record, filter));

    if (index === -1) {
      return { acknowledged: true, deletedCount: 0 };
    }

    this.records.splice(index, 1);
    return { acknowledged: true, deletedCount: 1 };
  }

  async deleteMany(filter: Filter<T>): Promise<DeleteResult> {
    const retained = this.records.filter((record) => !matches(record, filter));
    const deletedCount = this.records.length - retained.length;
    this.records = retained;

    return { acknowledged: true, deletedCount };
  }
}

function createFixture(owner = sessionA): CreatedBatch {
  const batch: BatchRecord = {
    id: batchId,
    sessionId: owner,
    status: "processing",
    totalFiles: 1,
    readyFiles: 0,
    failedFiles: 0,
    createdAt,
    expiresAt,
  };
  const document: DocumentRecord = {
    id: documentId,
    clientId: "69645762-69de-4f03-a2c1-b6f07a94f5b7",
    batchId,
    sessionId: owner,
    filename: "guide.pdf",
    mimeType: "application/pdf",
    fileType: "pdf",
    blobPathname: "client-controlled/path.pdf",
    size: 1_024,
    status: "queued",
    createdAt,
    expiresAt,
  };

  return { batch, documents: [document] };
}

function createMemoryRepository() {
  const batches = new MemoryCollection<BatchRecord>();
  const documents = new MemoryCollection<DocumentRecord>();
  const collections: BatchRepositoryCollections = { batches, documents };

  return {
    batches,
    documents,
    repository: createBatchRepository(collections),
  };
}

describe("batch repository", () => {
  test("creates a batch and replaces the Blob pathname with the server contract", async () => {
    const { batches, documents, repository } = createMemoryRepository();

    const created = await repository.createBatch(createFixture());

    expect(created.documents[0].blobPathname).toBe(
      `documents/${batchId}/${documentId}.pdf`,
    );
    expect(batches.records).toHaveLength(1);
    expect(documents.records).toEqual(created.documents);
  });

  test("compensates both collections after a partial document insertion", async () => {
    const { batches, documents, repository } = createMemoryRepository();
    documents.failAfterInsertMany = true;

    await expect(repository.createBatch(createFixture())).rejects.toThrow(
      "simulated document insert failure",
    );
    expect(batches.records).toEqual([]);
    expect(documents.records).toEqual([]);
  });

  test("isolates reads and transitions between sessions", async () => {
    const { documents, repository } = createMemoryRepository();
    await repository.createBatch(createFixture());

    await expect(
      repository.findBatchBySession(sessionB, batchId),
    ).resolves.toBeNull();
    await expect(
      repository.findDocumentBySession(sessionB, batchId, documentId),
    ).resolves.toBeNull();
    await expect(
      repository.markDocumentUploading({
        sessionId: sessionB,
        batchId,
        documentId,
      }),
    ).resolves.toBeNull();
    expect(documents.records[0].status).toBe("queued");
  });

  test("makes upload authorization and callback transitions idempotent", async () => {
    const { documents, repository } = createMemoryRepository();
    await repository.createBatch(createFixture());

    const startUpload = {
      sessionId: sessionA,
      batchId,
      documentId,
    };
    await expect(
      repository.markDocumentUploading(startUpload),
    ).resolves.toMatchObject({ status: "uploading" });
    await expect(
      repository.markDocumentUploading(startUpload),
    ).resolves.toMatchObject({ status: "uploading" });

    const callback = {
      sessionId: sessionA,
      batchId,
      documentId,
      blobUrl: "https://blob.example/guide.pdf",
    };
    await expect(
      repository.completeDocumentUpload(callback),
    ).resolves.toMatchObject({
      status: "validating",
      blobUrl: callback.blobUrl,
    });
    await expect(
      repository.completeDocumentUpload(callback),
    ).resolves.toMatchObject({
      status: "validating",
      blobUrl: callback.blobUrl,
    });

    expect(documents.updateCount).toBe(2);
    await expect(
      repository.completeDocumentUpload({
        ...callback,
        blobUrl: "https://blob.example/different.pdf",
      }),
    ).resolves.toBeNull();
  });

  test("refuses an upload failure reported by another session", async () => {
    const { documents, repository } = createMemoryRepository();
    await repository.createBatch(createFixture());
    await repository.markDocumentUploading({
      sessionId: sessionA,
      batchId,
      documentId,
    });

    await expect(
      repository.failDocumentUpload({
        sessionId: sessionB,
        batchId,
        documentId,
        error: { code: "UPLOAD_FAILED", message: "Network interrupted." },
      }),
    ).resolves.toBeNull();
    expect(documents.records[0]).toMatchObject({ status: "uploading" });
  });

  test("makes a repeated upload failure with the same error idempotent", async () => {
    const { documents, repository } = createMemoryRepository();
    await repository.createBatch(createFixture());
    const ownership = { sessionId: sessionA, batchId, documentId };
    const error = { code: "UPLOAD_FAILED", message: "Network interrupted." };
    await repository.markDocumentUploading(ownership);

    await expect(
      repository.failDocumentUpload({ ...ownership, error }),
    ).resolves.toMatchObject({ status: "failed", error });
    await expect(
      repository.failDocumentUpload({ ...ownership, error }),
    ).resolves.toMatchObject({ status: "failed", error });

    expect(documents.updateCount).toBe(2);
  });

  test("lets a verified callback recover a client-side upload failure race", async () => {
    const { repository } = createMemoryRepository();
    await repository.createBatch(createFixture());
    const ownership = { sessionId: sessionA, batchId, documentId };
    await repository.markDocumentUploading(ownership);
    await repository.failDocumentUpload({
      ...ownership,
      error: { code: "UPLOAD_FAILED", message: "Network interrupted." },
    });

    await expect(
      repository.completeDocumentUpload({
        ...ownership,
        blobUrl: "https://blob.example/guide.pdf",
      }),
    ).resolves.toMatchObject({
      status: "validating",
      blobUrl: "https://blob.example/guide.pdf",
    });
  });

  test("refuses an upload failure from an incompatible state", async () => {
    const { documents, repository } = createMemoryRepository();
    await repository.createBatch(createFixture());

    await expect(
      repository.failDocumentUpload({
        sessionId: sessionA,
        batchId,
        documentId,
        error: { code: "UPLOAD_FAILED", message: "Network interrupted." },
      }),
    ).resolves.toBeNull();
    expect(documents.records[0]).toMatchObject({ status: "queued" });
    expect(documents.records[0]).not.toHaveProperty("error");
  });
});
