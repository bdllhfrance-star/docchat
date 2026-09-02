import { describe, expect, test, vi } from "vitest";

import type { DocumentRecord } from "@/types/persistence";

import {
  handleDeleteDocument,
  handleRetryDocument,
  type DeleteDocumentDependencies,
  type RetryDocumentDependencies,
} from "./document-actions";

const documentId = "e267df76-9b0e-4616-b187-0252faf57880";
const batchId = "9f92701f-4866-45e6-b21f-1be3decc8d7d";
const sessionId = "271bf840-1fed-443d-86fb-a82b0bd70465";

function document(
  overrides: Partial<DocumentRecord> = {},
): DocumentRecord {
  return {
    id: documentId,
    clientId: "5f36e79a-30b9-4866-9157-524d7de72af3",
    batchId,
    sessionId,
    filename: "guide.pdf",
    mimeType: "application/pdf",
    fileType: "pdf",
    blobPathname: `documents/${batchId}/${documentId}.pdf`,
    blobUrl: "https://blob.example/guide.pdf",
    size: 1024,
    status: "failed",
    error: { code: "INVALID_PDF", message: "The PDF is invalid." },
    createdAt: new Date("2026-09-02T08:00:00.000Z"),
    expiresAt: new Date("2026-09-09T08:00:00.000Z"),
    ...overrides,
  };
}

function retryDependencies(
  overrides: Partial<RetryDocumentDependencies> = {},
): RetryDocumentDependencies {
  return {
    requireSession: vi.fn().mockResolvedValue(sessionId),
    findDocument: vi.fn().mockResolvedValue(document()),
    restartFailedDocument: vi
      .fn()
      .mockResolvedValue(document({ status: "validating", error: undefined })),
    ingestDocument: vi.fn().mockResolvedValue(undefined),
    requestId: () => "request-123",
    ...overrides,
  };
}

function deleteDependencies(
  overrides: Partial<DeleteDocumentDependencies> = {},
): DeleteDocumentDependencies {
  return {
    requireSession: vi.fn().mockResolvedValue(sessionId),
    findDocument: vi
      .fn()
      .mockResolvedValue(document({ status: "ready", error: undefined })),
    deleteBlob: vi.fn().mockResolvedValue(undefined),
    deleteDocument: vi.fn().mockResolvedValue({
      batchDeleted: false,
      deleted: true,
    }),
    requestId: () => "request-123",
    ...overrides,
  };
}

describe("retry document API", () => {
  test("restarts a failed document from its stored original", async () => {
    const failed = document();
    const ready = document({ status: "ready", error: undefined });
    const deps = retryDependencies({
      findDocument: vi
        .fn()
        .mockResolvedValueOnce(failed)
        .mockResolvedValueOnce(ready),
    });

    const response = await handleRetryDocument(documentId, deps);

    expect(response.status).toBe(200);
    expect(deps.restartFailedDocument).toHaveBeenCalledWith({
      sessionId,
      batchId,
      documentId,
    });
    expect(deps.ingestDocument).toHaveBeenCalledWith(
      expect.objectContaining({ status: "validating" }),
    );
    await expect(response.json()).resolves.toMatchObject({
      document: { id: documentId, status: "ready" },
    });
  });

  test("treats a repeated retry during processing as accepted", async () => {
    const deps = retryDependencies({
      findDocument: vi
        .fn()
        .mockResolvedValue(document({ status: "embedding", error: undefined })),
    });

    const response = await handleRetryDocument(documentId, deps);

    expect(response.status).toBe(202);
    expect(deps.restartFailedDocument).not.toHaveBeenCalled();
    expect(deps.ingestDocument).not.toHaveBeenCalled();
  });

  test("requires replacement when the uploaded original is unavailable", async () => {
    const deps = retryDependencies({
      findDocument: vi.fn().mockResolvedValue(
        document({
          blobUrl: undefined,
          error: { code: "UPLOAD_FAILED", message: "Upload failed." },
        }),
      ),
    });

    const response = await handleRetryDocument(documentId, deps);

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: "INVALID_REQUEST" },
    });
    expect(deps.restartFailedDocument).not.toHaveBeenCalled();
  });

  test("does not reveal or retry another session's document", async () => {
    const deps = retryDependencies({
      findDocument: vi.fn().mockResolvedValue(null),
    });

    const response = await handleRetryDocument(documentId, deps);

    expect(response.status).toBe(404);
    expect(deps.findDocument).toHaveBeenCalledWith(sessionId, documentId);
    expect(deps.restartFailedDocument).not.toHaveBeenCalled();
  });
});

describe("delete document API", () => {
  test("deletes Blob first and then removes owned database records", async () => {
    const order: string[] = [];
    const deps = deleteDependencies({
      deleteBlob: vi.fn(async () => {
        order.push("blob");
      }),
      deleteDocument: vi.fn(async () => {
        order.push("database");
        return { batchDeleted: false, deleted: true };
      }),
    });

    const response = await handleDeleteDocument(documentId, deps);

    expect(response.status).toBe(204);
    expect(order).toEqual(["blob", "database"]);
    expect(deps.deleteDocument).toHaveBeenCalledWith({
      sessionId,
      batchId,
      documentId,
    });
  });

  test("keeps database records when Blob deletion fails", async () => {
    const deps = deleteDependencies({
      deleteBlob: vi.fn().mockRejectedValue(new Error("Blob unavailable")),
    });

    const response = await handleDeleteDocument(documentId, deps);

    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({
      error: { code: "PROVIDER_ERROR" },
    });
    expect(deps.deleteDocument).not.toHaveBeenCalled();
  });

  test("reports a database deletion that left the document in place", async () => {
    const stored = document({ status: "ready", error: undefined });
    const deps = deleteDependencies({
      findDocument: vi.fn().mockResolvedValue(stored),
      deleteDocument: vi.fn().mockResolvedValue({
        batchDeleted: false,
        deleted: false,
      }),
    });

    const response = await handleDeleteDocument(documentId, deps);

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      error: { code: "INTERNAL_ERROR" },
    });
  });

  test("removes a failed upload without calling Blob when no original exists", async () => {
    const deps = deleteDependencies({
      findDocument: vi.fn().mockResolvedValue(document({ blobUrl: undefined })),
    });

    const response = await handleDeleteDocument(documentId, deps);

    expect(response.status).toBe(204);
    expect(deps.deleteBlob).not.toHaveBeenCalled();
    expect(deps.deleteDocument).toHaveBeenCalledOnce();
  });

  test("refuses deletion while processing is active", async () => {
    const deps = deleteDependencies({
      findDocument: vi
        .fn()
        .mockResolvedValue(document({ status: "extracting", error: undefined })),
    });

    const response = await handleDeleteDocument(documentId, deps);

    expect(response.status).toBe(409);
    expect(deps.deleteBlob).not.toHaveBeenCalled();
    expect(deps.deleteDocument).not.toHaveBeenCalled();
  });

  test("rejects invalid identifiers before reading session data", async () => {
    const deps = deleteDependencies();
    const response = await handleDeleteDocument("invalid", deps);

    expect(response.status).toBe(400);
    expect(deps.requireSession).not.toHaveBeenCalled();
    expect(deps.findDocument).not.toHaveBeenCalled();
  });
});
