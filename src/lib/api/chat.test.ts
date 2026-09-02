// @vitest-environment node

import { describe, expect, test, vi } from "vitest";

import type { ChatApiDependencies } from "@/lib/api/chat";
import { MAX_CHAT_REQUEST_BODY_BYTES } from "@/lib/api/chat";
import { VectorRetrievalError } from "@/lib/rag/vector-search";
import type { BatchRecord, DocumentRecord } from "@/types/persistence";

import { handleChatRequest } from "./chat";

const sessionId = "271bf840-1fed-443d-86fb-a82b0bd70465";
const batchId = "9f92701f-4866-45e6-b21f-1be3decc8d7d";
const documentId = "e267df76-9b0e-4616-b187-0252faf57880";

const batch: BatchRecord = {
  id: batchId,
  sessionId,
  status: "ready",
  totalFiles: 1,
  readyFiles: 1,
  failedFiles: 0,
  createdAt: new Date("2026-09-02T08:00:00.000Z"),
  expiresAt: new Date("2026-09-09T08:00:00.000Z"),
};

const document: DocumentRecord = {
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
  status: "ready",
  createdAt: batch.createdAt,
  expiresAt: batch.expiresAt,
};

function request(overrides: Record<string, unknown> = {}): Request {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    body: JSON.stringify({
      batchId,
      documentIds: [documentId],
      message: "What does the guide require?",
      history: [{ role: "user", content: "Earlier question" }],
      ...overrides,
    }),
  });
}

function dependencies(
  overrides: Partial<ChatApiDependencies> = {},
): ChatApiDependencies {
  return {
    requireSession: vi.fn().mockResolvedValue(sessionId),
    findBatchBySession: vi.fn().mockResolvedValue(batch),
    findDocumentsByBatch: vi.fn().mockResolvedValue([document]),
    retrieveChunks: vi.fn().mockResolvedValue([
      {
        id: "chunk-1",
        documentId,
        filename: "guide.pdf",
        fileType: "pdf",
        text: "The guide requires grounded answers.",
        source: { label: "Page 2", page: 2 },
        chunkIndex: 1,
        score: 0.93,
      },
    ]),
    streamResponse: vi.fn(() =>
      new Response("stream", {
        headers: { "content-type": "text/event-stream" },
      }),
    ),
    requestId: () => "request-123",
    ...overrides,
  };
}

describe("chat API", () => {
  test("retrieves only selected owned documents before starting the stream", async () => {
    const deps = dependencies();
    const response = await handleChatRequest(request(), deps);

    expect(response.status).toBe(200);
    expect(deps.findBatchBySession).toHaveBeenCalledWith(sessionId, batchId);
    expect(deps.retrieveChunks).toHaveBeenCalledWith({
      sessionId,
      batchId,
      documentIds: [documentId],
      query: "What does the guide require?",
      limit: 500,
      abortSignal: expect.any(AbortSignal),
    });
    expect(deps.streamResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        question: "What does the guide require?",
        history: [{ role: "user", content: "Earlier question" }],
        context: expect.objectContaining({
          chunks: [expect.objectContaining({ id: "chunk-1" })],
          sources: [expect.objectContaining({ score: 0.93 })],
        }),
      }),
    );
  });

  test("rejects invalid or oversized input before reading the session", async () => {
    const deps = dependencies();
    const duplicateResponse = await handleChatRequest(
      request({ documentIds: [documentId, documentId] }),
      deps,
    );
    const oversizedResponse = await handleChatRequest(
      request({ message: "x".repeat(MAX_CHAT_REQUEST_BODY_BYTES + 1) }),
      deps,
    );

    expect(duplicateResponse.status).toBe(400);
    expect(oversizedResponse.status).toBe(413);
    expect(deps.requireSession).not.toHaveBeenCalled();
  });

  test("requires a valid session and owned batch", async () => {
    const missingSession = dependencies({
      requireSession: vi.fn().mockResolvedValue(null),
    });
    const missingBatch = dependencies({
      findBatchBySession: vi.fn().mockResolvedValue(null),
      findDocumentsByBatch: vi.fn().mockResolvedValue([]),
    });

    await expect(
      handleChatRequest(request(), missingSession),
    ).resolves.toMatchObject({ status: 401 });
    await expect(
      handleChatRequest(request(), missingBatch),
    ).resolves.toMatchObject({ status: 404 });
    expect(missingSession.findBatchBySession).not.toHaveBeenCalled();
  });

  test("blocks chat until every retained document is ready", async () => {
    const deps = dependencies({
      findBatchBySession: vi.fn().mockResolvedValue({
        ...batch,
        status: "partial",
        failedFiles: 1,
        readyFiles: 0,
      }),
      findDocumentsByBatch: vi
        .fn()
        .mockResolvedValue([{ ...document, status: "failed" }]),
    });

    const response = await handleChatRequest(request(), deps);

    expect(response.status).toBe(409);
    expect(deps.retrieveChunks).not.toHaveBeenCalled();
    expect(deps.streamResponse).not.toHaveBeenCalled();
  });

  test("does not search a document outside the owned batch", async () => {
    const deps = dependencies();
    const response = await handleChatRequest(
      request({
        documentIds: ["80ca62f0-dac4-49c3-aef2-60f0f2b4c1ae"],
      }),
      deps,
    );

    expect(response.status).toBe(404);
    expect(deps.retrieveChunks).not.toHaveBeenCalled();
  });

  test("returns a structured provider error before streaming", async () => {
    const deps = dependencies({
      retrieveChunks: vi.fn().mockRejectedValue(
        new VectorRetrievalError(
          "RETRIEVAL_SEARCH_FAILED",
          "provider details",
        ),
      ),
    });

    const response = await handleChatRequest(request(), deps);

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "PROVIDER_ERROR",
        message: "The document search could not be completed.",
      },
    });
    expect(deps.streamResponse).not.toHaveBeenCalled();
  });
});
