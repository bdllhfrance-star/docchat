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
import type { ChunkRecord } from "@/types/documents";

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

    if (
      expected &&
      typeof expected === "object" &&
      "$in" in expected &&
      Array.isArray(expected.$in)
    ) {
      return expected.$in.includes(record[key as keyof T]);
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
  beforeUpdate?: (
    filter: Filter<T>,
    update: UpdateFilter<T>,
  ) => Promise<void>;

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

  find(filter: Filter<T>): { toArray: () => Promise<T[]> } {
    return {
      toArray: async () =>
        this.records.filter((record) => matches(record, filter)),
    };
  }

  async findOne(filter: Filter<T>): Promise<T | null> {
    return this.records.find((record) => matches(record, filter)) ?? null;
  }

  async updateOne(
    filter: Filter<T>,
    update: UpdateFilter<T>,
  ): Promise<UpdateResult<T>> {
    await this.beforeUpdate?.(filter, update);
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

  async countDocuments(filter: Filter<T>): Promise<number> {
    return this.records.filter((record) => matches(record, filter)).length;
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
  const chunks = new MemoryCollection<ChunkRecord>();
  const collections: BatchRepositoryCollections = {
    batches,
    documents,
    chunks,
  };

  return {
    batches,
    documents,
    chunks,
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

  test("appends documents to the same batch and preserves server-owned paths", async () => {
    const { batches, documents, repository } = createMemoryRepository();
    await repository.createBatch(createFixture());
    const addedDocument: DocumentRecord = {
      ...createFixture().documents[0],
      id: "8337341e-81ba-4b21-9921-ef129cfe18f3",
      clientId: "4a616093-d677-42d3-8379-6dbaa9bd900a",
      filename: "appendix.pdf",
      blobPathname: "client-controlled/appendix.pdf",
    };

    const added = await repository.appendDocuments({
      batchId,
      documents: [addedDocument],
      sessionId: sessionA,
    });

    expect(added).toEqual([
      expect.objectContaining({
        id: addedDocument.id,
        blobPathname: `documents/${batchId}/${addedDocument.id}.pdf`,
      }),
    ]);
    expect(documents.records).toHaveLength(2);
    expect(batches.records[0]).toMatchObject({
      totalFiles: 2,
      status: "processing",
    });
  });

  test("removes partially inserted additions when appending fails", async () => {
    const { batches, documents, repository } = createMemoryRepository();
    await repository.createBatch(createFixture());
    documents.failAfterInsertMany = true;
    const addedDocument: DocumentRecord = {
      ...createFixture().documents[0],
      id: "8337341e-81ba-4b21-9921-ef129cfe18f3",
    };

    await expect(
      repository.appendDocuments({
        batchId,
        documents: [addedDocument],
        sessionId: sessionA,
      }),
    ).rejects.toThrow("simulated document insert failure");
    expect(documents.records).toHaveLength(1);
    expect(batches.records[0].totalFiles).toBe(1);
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
      repository.findDocumentByIdForSession(sessionB, documentId),
    ).resolves.toBeNull();
    await expect(
      repository.findDocumentsByBatch(sessionB, batchId),
    ).resolves.toEqual([]);
    await expect(
      repository.markDocumentUploading({
        sessionId: sessionB,
        batchId,
        documentId,
      }),
    ).resolves.toBeNull();
    expect(documents.records[0].status).toBe("queued");
  });

  test("lists only documents owned by the requested session and batch", async () => {
    const { repository } = createMemoryRepository();
    await repository.createBatch(createFixture());

    await expect(
      repository.findDocumentsByBatch(sessionA, batchId),
    ).resolves.toEqual([
      expect.objectContaining({ id: documentId, sessionId: sessionA, batchId }),
    ]);
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

  test("stores chunks before marking the document and batch ready", async () => {
    const { batches, chunks, documents, repository } = createMemoryRepository();
    await repository.createBatch(createFixture());
    const ownership = { sessionId: sessionA, batchId, documentId };

    await repository.markDocumentUploading(ownership);
    await repository.completeDocumentUpload({
      ...ownership,
      blobUrl: "https://blob.example/guide.pdf",
    });
    await repository.transitionDocumentStatus(
      ownership,
      "validating",
      "extracting",
    );
    await repository.transitionDocumentStatus(
      ownership,
      "extracting",
      "chunking",
    );
    await repository.transitionDocumentStatus(
      ownership,
      "chunking",
      "embedding",
    );
    await repository.transitionDocumentStatus(
      ownership,
      "embedding",
      "indexing",
    );

    const chunk: ChunkRecord = {
      id: "80140e63-f8cb-4095-9cbd-dae9da4cf930",
      sessionId: sessionA,
      batchId,
      documentId,
      filename: "guide.pdf",
      fileType: "pdf",
      text: "Indexed text",
      embedding: Array.from({ length: 768 }, () => 0.1),
      source: { label: "Page 1", page: 1 },
      chunkIndex: 0,
      createdAt,
      expiresAt,
    };
    await expect(
      repository.completeDocumentIndexing({ ...ownership, chunks: [chunk] }),
    ).resolves.toMatchObject({ status: "ready" });

    expect(chunks.records).toEqual([chunk]);
    expect(documents.records[0]).toMatchObject({ status: "ready" });
    expect(batches.records[0]).toMatchObject({
      status: "ready",
      readyFiles: 1,
      failedFiles: 0,
    });
  });

  test("does not let a slower document callback regress a ready batch", async () => {
    const { batches, documents, repository } = createMemoryRepository();
    const secondDocumentId = "d365a6b0-1b4c-4911-a5fd-ea6708852f17";
    const fixture = createFixture();
    fixture.batch.totalFiles = 2;
    fixture.documents.push({
      ...fixture.documents[0],
      id: secondDocumentId,
      clientId: "493e0109-080f-4d21-a95d-b67cff53dc48",
      filename: "classroom.pdf",
    });
    await repository.createBatch(fixture);
    documents.records.forEach((document) => {
      document.status = "indexing";
    });

    let releaseFirstRefresh: () => void = () => {};
    let signalFirstRefresh: () => void = () => {};
    const firstRefreshStarted = new Promise<void>((resolve) => {
      signalFirstRefresh = resolve;
    });
    const firstRefreshReleased = new Promise<void>((resolve) => {
      releaseFirstRefresh = resolve;
    });
    let refreshCalls = 0;
    batches.beforeUpdate = async () => {
      refreshCalls += 1;

      if (refreshCalls === 1) {
        signalFirstRefresh();
        await firstRefreshReleased;
      }
    };
    const chunkFor = (id: string, filename: string): ChunkRecord => ({
      id: `chunk-${id}`,
      sessionId: sessionA,
      batchId,
      documentId: id,
      filename,
      fileType: "pdf",
      text: "Indexed text",
      embedding: Array.from({ length: 768 }, () => 0.1),
      source: { label: "Page 1", page: 1 },
      chunkIndex: 0,
      createdAt,
      expiresAt,
    });

    const firstCompletion = repository.completeDocumentIndexing({
      sessionId: sessionA,
      batchId,
      documentId,
      chunks: [chunkFor(documentId, "guide.pdf")],
    });
    await firstRefreshStarted;
    await repository.completeDocumentIndexing({
      sessionId: sessionA,
      batchId,
      documentId: secondDocumentId,
      chunks: [chunkFor(secondDocumentId, "classroom.pdf")],
    });
    releaseFirstRefresh();
    await firstCompletion;

    expect(batches.records[0]).toMatchObject({
      status: "ready",
      readyFiles: 2,
      failedFiles: 0,
    });
  });

  test("marks a processing failure and refreshes batch progress", async () => {
    const { batches, repository } = createMemoryRepository();
    await repository.createBatch(createFixture());
    const ownership = { sessionId: sessionA, batchId, documentId };
    await repository.markDocumentUploading(ownership);
    await repository.completeDocumentUpload({
      ...ownership,
      blobUrl: "https://blob.example/guide.pdf",
    });

    await expect(
      repository.failDocumentProcessing({
        ...ownership,
        error: { code: "INVALID_PDF", message: "The PDF is invalid." },
      }),
    ).resolves.toMatchObject({
      status: "failed",
      error: { code: "INVALID_PDF" },
    });
    expect(batches.records[0]).toMatchObject({
      status: "failed",
      readyFiles: 0,
      failedFiles: 1,
    });
  });

  test("restarts only a failed document that still has its uploaded original", async () => {
    const { batches, chunks, documents, repository } = createMemoryRepository();
    await repository.createBatch(createFixture());
    Object.assign(documents.records[0], {
      status: "failed",
      blobUrl: "https://blob.example/guide.pdf",
      error: { code: "INVALID_PDF", message: "The PDF is invalid." },
    });
    Object.assign(batches.records[0], { status: "failed", failedFiles: 1 });
    chunks.records.push({
      id: "80140e63-f8cb-4095-9cbd-dae9da4cf930",
      sessionId: sessionA,
      batchId,
      documentId,
      filename: "guide.pdf",
      fileType: "pdf",
      text: "stale chunk",
      embedding: [0.1],
      source: { label: "Page 1", page: 1 },
      chunkIndex: 0,
      createdAt,
      expiresAt,
    });

    await expect(
      repository.restartFailedDocument({ sessionId: sessionA, batchId, documentId }),
    ).resolves.toMatchObject({ status: "validating" });
    expect(documents.records[0]).not.toHaveProperty("error");
    expect(chunks.records).toEqual([]);
    expect(batches.records[0]).toMatchObject({
      status: "processing",
      failedFiles: 0,
    });
    await expect(
      repository.restartFailedDocument({ sessionId: sessionA, batchId, documentId }),
    ).resolves.toBeNull();
  });

  test("replaces a failed document in place and clears its stale chunks", async () => {
    const { batches, chunks, documents, repository } = createMemoryRepository();
    await repository.createBatch(createFixture());
    Object.assign(documents.records[0], {
      status: "failed",
      blobUrl: "https://blob.example/guide.pdf",
      error: { code: "INVALID_PDF", message: "The PDF is invalid." },
    });
    Object.assign(batches.records[0], { status: "failed", failedFiles: 1 });
    chunks.records.push({
      id: "80140e63-f8cb-4095-9cbd-dae9da4cf930",
      sessionId: sessionA,
      batchId,
      documentId,
      filename: "guide.pdf",
      fileType: "pdf",
      text: "stale chunk",
      embedding: [0.1],
      source: { label: "Page 1", page: 1 },
      chunkIndex: 0,
      createdAt,
      expiresAt,
    });

    await expect(
      repository.prepareDocumentReplacement({
        sessionId: sessionA,
        batchId,
        documentId,
        clientId: "0821134d-a736-4cc4-baa9-9ac3a6d42a10",
        filename: "replacement.xlsx",
        mimeType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        fileType: "xlsx",
        blobPathname: `documents/${batchId}/${documentId}.xlsx`,
        size: 2048,
      }),
    ).resolves.toMatchObject({
      id: documentId,
      filename: "replacement.xlsx",
      fileType: "xlsx",
      status: "queued",
    });
    expect(chunks.records).toEqual([]);
    expect(documents.records[0]).not.toHaveProperty("blobUrl");
    expect(documents.records[0]).not.toHaveProperty("error");
    expect(batches.records[0]).toMatchObject({
      status: "processing",
      failedFiles: 0,
    });
  });

  test("restores the original failed record after replacement setup fails", async () => {
    const { documents, repository } = createMemoryRepository();
    await repository.createBatch(createFixture());
    Object.assign(documents.records[0], {
      status: "failed",
      blobUrl: "https://blob.example/guide.pdf",
      error: { code: "INVALID_PDF", message: "The PDF is invalid." },
    });
    const original = structuredClone(documents.records[0]);
    const replacementClientId = "0821134d-a736-4cc4-baa9-9ac3a6d42a10";
    await repository.prepareDocumentReplacement({
      sessionId: sessionA,
      batchId,
      documentId,
      clientId: replacementClientId,
      filename: "replacement.xlsx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      fileType: "xlsx",
      blobPathname: `documents/${batchId}/${documentId}.xlsx`,
      size: 2048,
    });

    await expect(
      repository.restoreDocumentReplacement({
        sessionId: sessionA,
        batchId,
        documentId,
        replacementClientId,
        original,
      }),
    ).resolves.toMatchObject({
      filename: "guide.pdf",
      fileType: "pdf",
      status: "failed",
      blobUrl: "https://blob.example/guide.pdf",
      error: { code: "INVALID_PDF" },
    });
  });

  test("deletes a document and recalculates its remaining batch", async () => {
    const { batches, chunks, documents, repository } = createMemoryRepository();
    const fixture = createFixture();
    const secondDocumentId = "80ca62f0-dac4-49c3-aef2-60f0f2b4c1ae";
    fixture.batch.totalFiles = 2;
    fixture.documents.push({
      ...fixture.documents[0],
      id: secondDocumentId,
      clientId: "0821134d-a736-4cc4-baa9-9ac3a6d42a10",
      filename: "second.pdf",
    });
    await repository.createBatch(fixture);
    documents.records.forEach((storedDocument) => {
      storedDocument.status = "ready";
      storedDocument.blobUrl = `https://blob.example/${storedDocument.id}.pdf`;
    });
    chunks.records.push({
      id: "80140e63-f8cb-4095-9cbd-dae9da4cf930",
      sessionId: sessionA,
      batchId,
      documentId,
      filename: "guide.pdf",
      fileType: "pdf",
      text: "indexed chunk",
      embedding: [0.1],
      source: { label: "Page 1", page: 1 },
      chunkIndex: 0,
      createdAt,
      expiresAt,
    });

    await expect(
      repository.deleteDocument({ sessionId: sessionA, batchId, documentId }),
    ).resolves.toEqual({ batchDeleted: false, deleted: true });
    expect(chunks.records).toEqual([]);
    expect(documents.records).toHaveLength(1);
    expect(documents.records[0].id).toBe(secondDocumentId);
    expect(batches.records[0]).toMatchObject({
      totalFiles: 1,
      readyFiles: 1,
      failedFiles: 0,
      status: "ready",
    });

    await expect(
      repository.deleteDocument({
        sessionId: sessionA,
        batchId,
        documentId: secondDocumentId,
      }),
    ).resolves.toEqual({ batchDeleted: true, deleted: true });
    expect(documents.records).toEqual([]);
    expect(batches.records).toEqual([]);
  });
});
