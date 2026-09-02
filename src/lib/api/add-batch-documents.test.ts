import { describe, expect, test, vi } from "vitest";

import type { AppendDocuments } from "@/lib/db/batch-repository";
import type { BatchRecord, DocumentRecord } from "@/types/persistence";

import { handleAddBatchDocuments } from "./add-batch-documents";

const sessionId = "271bf840-1fed-443d-86fb-a82b0bd70465";
const batchId = "9f92701f-4866-45e6-b21f-1be3decc8d7d";
const clientId = "5f36e79a-30b9-4866-9157-524d7de72af3";
const documentId = "e267df76-9b0e-4616-b187-0252faf57880";
const addedDocumentId = "75f9d4bc-c530-43dd-a30f-91dad3ab8ff4";
const createdAt = new Date("2026-09-02T12:00:00.000Z");
const expiresAt = new Date("2026-09-09T12:00:00.000Z");

const batch: BatchRecord = {
  id: batchId,
  sessionId,
  status: "ready",
  totalFiles: 1,
  readyFiles: 1,
  failedFiles: 0,
  createdAt,
  expiresAt,
};

const existingDocument: DocumentRecord = {
  id: documentId,
  clientId: "4a616093-d677-42d3-8379-6dbaa9bd900a",
  batchId,
  sessionId,
  filename: "guide.pdf",
  mimeType: "application/pdf",
  fileType: "pdf",
  blobPathname: `documents/${batchId}/${documentId}.pdf`,
  blobUrl: "https://private.example.invalid/guide.pdf",
  size: 1024,
  status: "ready",
  createdAt,
  expiresAt,
};

function request() {
  return new Request(`http://localhost/api/batches/${batchId}/documents`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      files: [
        {
          clientId,
          filename: "appendix.pdf",
          size: 2048,
          mimeType: "application/pdf",
        },
      ],
    }),
  });
}

function dependencies() {
  const appendDocuments = vi.fn(async (addition: AppendDocuments) =>
    addition.documents,
  );

  return {
    appendDocuments,
    createId: () => addedDocumentId,
    findBatchBySession: vi.fn(async (): Promise<BatchRecord | null> => batch),
    findDocumentsByBatch: vi.fn(async () => [existingDocument]),
    now: () => createdAt,
    requestId: () => "request-123",
    requireSession: vi.fn(async () => sessionId),
  };
}

describe("add batch documents handler", () => {
  test("adds queued documents to the existing session batch", async () => {
    const deps = dependencies();
    const response = await handleAddBatchDocuments(request(), batchId, deps);

    expect(response.status).toBe(201);
    expect(deps.appendDocuments).toHaveBeenCalledWith({
      batchId,
      sessionId,
      documents: [
        expect.objectContaining({
          id: addedDocumentId,
          clientId,
          batchId,
          sessionId,
          status: "queued",
          blobPathname: `documents/${batchId}/${addedDocumentId}.pdf`,
        }),
      ],
    });
    await expect(response.json()).resolves.toMatchObject({
      batch: {
        id: batchId,
        status: "processing",
        documents: [
          { id: documentId, status: "ready" },
          { id: addedDocumentId, status: "queued" },
        ],
      },
      files: [
        {
          clientId,
          documentId: addedDocumentId,
          uploadPathname: `documents/${batchId}/${addedDocumentId}.pdf`,
        },
      ],
    });
  });

  test("rejects additions that exceed the existing session limits", async () => {
    const deps = dependencies();
    deps.findDocumentsByBatch.mockResolvedValue(
      Array.from({ length: 10 }, (_, index) => ({
        ...existingDocument,
        id: `${index}`,
      })),
    );

    const response = await handleAddBatchDocuments(request(), batchId, deps);

    expect(response.status).toBe(413);
    expect(deps.appendDocuments).not.toHaveBeenCalled();
  });

  test("waits for current processing before accepting more documents", async () => {
    const deps = dependencies();
    deps.findDocumentsByBatch.mockResolvedValue([
      { ...existingDocument, status: "embedding" },
    ]);

    const response = await handleAddBatchDocuments(request(), batchId, deps);

    expect(response.status).toBe(409);
    expect(deps.appendDocuments).not.toHaveBeenCalled();
  });

  test("does not expose batches owned by another session", async () => {
    const deps = dependencies();
    deps.findBatchBySession.mockResolvedValue(null);

    const response = await handleAddBatchDocuments(request(), batchId, deps);

    expect(response.status).toBe(404);
    expect(deps.appendDocuments).not.toHaveBeenCalled();
  });
});
