// @vitest-environment node

import { describe, expect, test, vi } from "vitest";

import { buildChatRequest } from "@/lib/chat/client";
import { retrieveHybridChunks } from "@/lib/rag/hybrid-search";
import type { DocChatUIMessage } from "@/types/api";
import type { CreatedBatch } from "@/types/persistence";

import { handleChatRequest } from "./chat";
import { handleCreateBatch } from "./create-batch";
import { observeApiRequest } from "./observability";

const sessionId = "271bf840-1fed-443d-86fb-a82b0bd70465";
const batchId = "9f92701f-4866-45e6-b21f-1be3decc8d7d";
const documentIds = [
  "e267df76-9b0e-4616-b187-0252faf57880",
  "75f9d4bc-c530-43dd-a30f-91dad3ab8ff4",
] as const;
const clientIds = [
  "5f36e79a-30b9-4866-9157-524d7de72af3",
  "80ca62f0-dac4-49c3-aef2-60f0f2b4c1ae",
] as const;
const question = "What requirements are shared across both documents?";

function request(path: string, body: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

function storedChunk(input: {
  documentId: string;
  filename: string;
  id: string;
  score: number;
  text: string;
}) {
  return {
    ...input,
    sessionId,
    batchId,
    fileType: "pdf" as const,
    source: { label: "Page 1", page: 1 },
    chunkIndex: 0,
  };
}

describe("multi-PDF bonus integration", () => {
  test("creates one batch, retrieves across both documents, logs safely, and enforces chat limits", async () => {
    const logLines: string[] = [];
    const writer = {
      error: vi.fn((line: string) => logLines.push(line)),
      info: vi.fn((line: string) => logLines.push(line)),
      warn: vi.fn((line: string) => logLines.push(line)),
    };
    let clock = 1_000;
    const observe = (
      input: Parameters<typeof observeApiRequest>[0],
      handler: () => Promise<Response>,
    ) =>
      observeApiRequest(input, handler, {
        writer,
        now: () => (clock += 10),
      });
    let created: CreatedBatch | undefined;
    let uploadChecks = 0;
    const ids = [batchId, ...documentIds];
    const createResponse = await observe(
      {
        method: "POST",
        operation: "batch.create",
        requestId: "request-create",
        route: "/api/batches",
      },
      () =>
        handleCreateBatch(
          request("/api/batches", {
            files: [
              {
                clientId: clientIds[0],
                filename: "requirements.pdf",
                mimeType: "application/pdf",
                size: 2_048,
              },
              {
                clientId: clientIds[1],
                filename: "appendix.pdf",
                mimeType: "application/pdf",
                size: 1_024,
              },
            ],
          }),
          {
            checkRateLimit: async () => ({
              success: ++uploadChecks <= 30,
              limit: 30,
              remaining: 30 - uploadChecks,
              reset: 61_000,
            }),
            createBatch: async (batch) => {
              created = structuredClone(batch);
              return batch;
            },
            createId: () => ids.shift()!,
            ensureSession: async () => ({ sessionId, created: true }),
            now: () => new Date("2026-09-02T12:00:00.000Z"),
            requestId: () => "request-create",
          },
        ),
    );

    expect(createResponse.status).toBe(201);
    expect(createResponse.headers.get("x-request-id")).toBe("request-create");
    expect(uploadChecks).toBe(1);
    expect(created?.documents.map((document) => document.id)).toEqual(
      documentIds,
    );

    const readyBatch = {
      ...created!.batch,
      status: "ready" as const,
      readyFiles: 2,
    };
    const readyDocuments = created!.documents.map((document) => ({
      ...document,
      blobUrl: `https://blob.example/${document.id}.pdf`,
      status: "ready" as const,
    }));
    const shared = storedChunk({
      id: "chunk-shared",
      documentId: documentIds[0],
      filename: "requirements.pdf",
      text: "Every answer must cite its supporting document.",
      score: 0.94,
    });
    const vectorOnly = storedChunk({
      id: "chunk-vector",
      documentId: documentIds[1],
      filename: "appendix.pdf",
      text: "The appendix requires a streamed response.",
      score: 0.88,
    });
    const lexicalOnly = storedChunk({
      id: "chunk-lexical",
      documentId: documentIds[1],
      filename: "appendix.pdf",
      text: "The appendix also describes multiple document uploads.",
      score: 4.2,
    });
    const aggregateVector = vi.fn(async () => [shared, vectorOnly]);
    const aggregateText = vi.fn(async () => [
      { ...shared, score: 5.1 },
      lexicalOnly,
    ]);
    const retrieveChunks = vi.fn((input) =>
      retrieveHybridChunks(input, {
        aggregateText,
        vector: {
          aggregate: aggregateVector,
          embedQuery: async () => Array.from({ length: 768 }, () => 0.1),
        },
      }),
    );
    const requireSession = vi.fn(async () => sessionId);
    let chatChecks = 0;
    const chatBody = buildChatRequest(batchId, documentIds, [
      {
        id: "question-1",
        role: "user",
        parts: [{ type: "text", text: question }],
      } satisfies DocChatUIMessage,
    ]);
    const chat = (requestId: string) =>
      observe(
        {
          method: "POST",
          operation: "chat.answer",
          requestId,
          route: "/api/chat",
        },
        () =>
          handleChatRequest(request("/api/chat", chatBody), {
            checkRateLimit: async () => ({
              success: ++chatChecks === 1,
              limit: 10,
              remaining: chatChecks === 1 ? 9 : 0,
              reset: Date.now() + 60_000,
            }),
            findBatchBySession: async () => readyBatch,
            findDocumentsByBatch: async () => readyDocuments,
            requireSession,
            retrieveChunks,
            streamResponse: ({ context }) =>
              Response.json({
                chunkIds: context.chunks.map((chunk) => chunk.id),
                sources: context.sources,
              }),
            requestId: () => requestId,
          }),
      );

    const chatResponse = await chat("request-chat-1");
    const answer = await chatResponse.json();

    expect(chatResponse.status).toBe(200);
    expect(retrieveChunks).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId,
        batchId,
        documentIds,
        query: question,
      }),
    );
    expect(new Set(answer.sources.map((source: { documentId: string }) =>
      source.documentId))).toEqual(new Set(documentIds));
    expect(
      answer.sources.every(
        (source: { scoreKind?: string }) => source.scoreKind === "rrf",
      ),
    ).toBe(true);
    expect(answer.chunkIds[0]).toBe("chunk-shared");
    expect(aggregateVector).toHaveBeenCalledOnce();
    expect(aggregateText).toHaveBeenCalledOnce();

    const limitedResponse = await chat("request-chat-2");

    expect(limitedResponse.status).toBe(429);
    expect(limitedResponse.headers.get("retry-after")).toBeTruthy();
    expect(retrieveChunks).toHaveBeenCalledOnce();
    expect(requireSession).toHaveBeenCalledOnce();
    expect(logLines.map((line) => JSON.parse(line).status)).toEqual([
      201,
      200,
      429,
    ]);
    expect(JSON.stringify(logLines)).not.toContain(question);
    expect(JSON.stringify(logLines)).not.toContain("requirements.pdf");
    expect(JSON.stringify(logLines)).not.toContain(sessionId);
  });
});
