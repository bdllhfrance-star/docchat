import type { PutBlobResult } from "@vercel/blob";
import type { HandleUploadOptions } from "@vercel/blob/client";
import { describe, expect, test, vi } from "vitest";

import type { DocumentRecord } from "@/types/persistence";

import { handleBlobUpload } from "./upload-blob";

const sessionId = "271bf840-1fed-443d-86fb-a82b0bd70465";
const batchId = "9f92701f-4866-45e6-b21f-1be3decc8d7d";
const documentId = "e267df76-9b0e-4616-b187-0252faf57880";
const pathname = `documents/${batchId}/${documentId}.pdf`;
const document: DocumentRecord = {
  id: documentId,
  clientId: "5f36e79a-30b9-4866-9157-524d7de72af3",
  batchId,
  sessionId,
  filename: "guide.pdf",
  mimeType: "application/pdf",
  fileType: "pdf",
  blobPathname: pathname,
  size: 1024,
  status: "queued",
  createdAt: new Date("2026-09-02T12:00:00.000Z"),
  expiresAt: new Date("2026-09-09T12:00:00.000Z"),
};

function request(body: unknown): Request {
  return new Request("http://localhost/api/upload", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

function dependencies() {
  return {
    blob: {
      token: "blob-read-write-token",
    },
    completeDocumentUpload: vi.fn(
      async (): Promise<DocumentRecord | null> => ({
        ...document,
        status: "validating",
        blobUrl: "https://private.example.invalid/document.pdf",
      }),
    ),
    failDocumentUpload: vi.fn(
      async (): Promise<DocumentRecord | null> => ({
        ...document,
        status: "failed",
      }),
    ),
    findDocumentBySession: vi.fn(
      async (): Promise<DocumentRecord | null> => document,
    ),
    markDocumentUploading: vi.fn(
      async (): Promise<DocumentRecord | null> => ({
        ...document,
        status: "uploading",
      }),
    ),
    ingestDocument: vi.fn(async () => undefined),
    requireSession: vi.fn(async (): Promise<string | null> => sessionId),
    now: () => 1_800_000_000_000,
    requestId: () => "request-123",
  };
}

function issuanceHandler(
  multipart = false,
  requestedPathname = pathname,
) {
  return vi.fn(async (options: HandleUploadOptions) => {
    const uploadOptions = await options.onBeforeGenerateToken(
      requestedPathname,
      JSON.stringify({ batchId, documentId }),
      multipart,
    );

    return {
      type: "blob.generate-client-token" as const,
      clientToken: JSON.stringify(uploadOptions),
    };
  });
}

describe("private Blob upload handler", () => {
  test("issues short-lived, document-scoped upload authorization", async () => {
    const deps = dependencies();
    const handleUpload = issuanceHandler();
    const response = await handleBlobUpload(
      request({ type: "blob.generate-client-token", payload: {} }),
      { ...deps, handleUpload },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      type: "blob.generate-client-token",
      clientToken: JSON.stringify({
        validUntil: 1_800_000_600_000,
        allowedContentTypes: ["application/pdf"],
        maximumSizeInBytes: 1024,
        addRandomSuffix: false,
        allowOverwrite: false,
        tokenPayload: JSON.stringify({ sessionId, batchId, documentId }),
      }),
    });
    expect(deps.findDocumentBySession).toHaveBeenCalledWith(
      sessionId,
      batchId,
      documentId,
    );
    expect(handleUpload).toHaveBeenCalledWith(
      expect.objectContaining({ token: "blob-read-write-token" }),
    );
    expect(deps.markDocumentUploading).toHaveBeenCalledWith({
      sessionId,
      batchId,
      documentId,
    });
  });

  test("rejects missing sessions, multipart, and divergent paths", async () => {
    const missingSession = dependencies();
    missingSession.requireSession.mockResolvedValueOnce(null);
    const sessionResponse = await handleBlobUpload(request({}), {
      ...missingSession,
      handleUpload: issuanceHandler(),
    });

    expect(sessionResponse.status).toBe(401);
    expect(missingSession.markDocumentUploading).not.toHaveBeenCalled();

    const multipart = dependencies();
    const multipartResponse = await handleBlobUpload(request({}), {
      ...multipart,
      handleUpload: issuanceHandler(true),
    });
    expect(multipartResponse.status).toBe(400);
    expect(multipart.markDocumentUploading).not.toHaveBeenCalled();

    const divergent = dependencies();
    const divergentResponse = await handleBlobUpload(request({}), {
      ...divergent,
      handleUpload: issuanceHandler(false, "documents/another.pdf"),
    });
    expect(divergentResponse.status).toBe(400);
    expect(divergent.markDocumentUploading).not.toHaveBeenCalled();
  });

  test("accepts a signed callback without requiring the browser cookie", async () => {
    const deps = dependencies();
    const checkRateLimit = vi.fn().mockResolvedValue({
      success: false,
      limit: 30,
      remaining: 0,
      reset: Date.now() + 60_000,
    });
    const blob: PutBlobResult = {
      url: "https://private.example.invalid/document.pdf",
      downloadUrl: "https://private.example.invalid/document.pdf?download=1",
      pathname,
      contentType: "application/pdf",
      contentDisposition: 'attachment; filename="document.pdf"',
      etag: "etag",
    };
    const handleUpload = vi.fn(
      async (options: HandleUploadOptions) => {
        await options.onUploadCompleted?.({
          blob,
          tokenPayload: JSON.stringify({ sessionId, batchId, documentId }),
        });

        return {
          type: "blob.upload-completed" as const,
          response: "ok" as const,
        };
      },
    );

    const response = await handleBlobUpload(request({}), {
      ...deps,
      checkRateLimit,
      handleUpload,
    });

    expect(response.status).toBe(200);
    expect(checkRateLimit).not.toHaveBeenCalled();
    expect(deps.requireSession).not.toHaveBeenCalled();
    expect(deps.completeDocumentUpload).toHaveBeenCalledWith({
      sessionId,
      batchId,
      documentId,
      blobUrl: blob.url,
    });
    expect(deps.ingestDocument).toHaveBeenCalledWith(
      expect.objectContaining({ status: "validating", blobUrl: blob.url }),
    );
  });

  test("returns not found for a document owned by another session", async () => {
    const deps = dependencies();
    deps.findDocumentBySession.mockResolvedValueOnce(null);
    const response = await handleBlobUpload(request({}), {
      ...deps,
      handleUpload: issuanceHandler(),
    });

    expect(response.status).toBe(404);
    expect(deps.markDocumentUploading).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "NOT_FOUND", requestId: "request-123" },
    });
  });

  test("records an authenticated browser upload failure", async () => {
    const deps = dependencies();
    const response = await handleBlobUpload(
      request({
        type: "docchat.upload-failed",
        payload: { batchId, documentId },
      }),
      deps,
    );

    expect(response.status).toBe(200);
    expect(deps.failDocumentUpload).toHaveBeenCalledWith({
      sessionId,
      batchId,
      documentId,
      error: {
        code: "UPLOAD_FAILED",
        message: "The browser upload did not complete.",
      },
    });
    expect(deps.markDocumentUploading).not.toHaveBeenCalled();
  });

  test("stops a rate-limited browser upload before session work", async () => {
    const deps = dependencies();
    const response = await handleBlobUpload(request({}), {
      ...deps,
      checkRateLimit: vi.fn().mockResolvedValue({
        success: false,
        limit: 30,
        remaining: 0,
        reset: Date.now() + 60_000,
      }),
      handleUpload: issuanceHandler(),
    });

    expect(response.status).toBe(429);
    expect(deps.requireSession).not.toHaveBeenCalled();
    expect(deps.markDocumentUploading).not.toHaveBeenCalled();
  });

  test("does not return a token or acknowledge a callback after a refused transition", async () => {
    const refusedAuthorization = dependencies();
    refusedAuthorization.markDocumentUploading.mockResolvedValueOnce(null);
    const authorizationResponse = await handleBlobUpload(request({}), {
      ...refusedAuthorization,
      handleUpload: issuanceHandler(),
    });

    expect(authorizationResponse.status).toBe(409);
    expect(refusedAuthorization.markDocumentUploading).toHaveBeenCalledOnce();

    const refusedCallback = dependencies();
    refusedCallback.completeDocumentUpload.mockResolvedValueOnce(null);
    const blob: PutBlobResult = {
      url: "https://private.example.invalid/document.pdf",
      downloadUrl: "https://private.example.invalid/document.pdf?download=1",
      pathname,
      contentType: "application/pdf",
      contentDisposition: "attachment",
      etag: "etag",
    };
    const callbackResponse = await handleBlobUpload(request({}), {
      ...refusedCallback,
      handleUpload: vi.fn(async (options: HandleUploadOptions) => {
        await options.onUploadCompleted?.({
          blob,
          tokenPayload: JSON.stringify({ sessionId, batchId, documentId }),
        });

        return {
          type: "blob.upload-completed" as const,
          response: "ok" as const,
        };
      }),
    });

    expect(callbackResponse.status).toBe(409);
    expect(refusedCallback.ingestDocument).not.toHaveBeenCalled();
  });
});
