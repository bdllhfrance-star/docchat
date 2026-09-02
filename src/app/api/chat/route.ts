import { randomUUID } from "node:crypto";

import { handleChatRequest } from "@/lib/api/chat";
import { observeApiRequest } from "@/lib/api/observability";
import { createChatStreamResponse } from "@/lib/chat/stream";
import { getBatchRepository } from "@/lib/db/batch-repository";
import { retrieveHybridChunks } from "@/lib/rag/hybrid-search";
import { checkRequestRateLimit } from "@/lib/rate-limit";
import { requireSession } from "@/lib/session-request";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const requestId = randomUUID();
  let repositoryPromise: ReturnType<typeof getBatchRepository> | undefined;
  const repository = () => {
    repositoryPromise ??= getBatchRepository();
    return repositoryPromise;
  };

  return observeApiRequest(
    {
      method: "POST",
      operation: "chat.answer",
      requestId,
      route: "/api/chat",
    },
    () =>
      handleChatRequest(request, {
        requireSession,
        checkRateLimit: () => checkRequestRateLimit(request, "chat"),
        findBatchBySession: async (sessionId, batchId) =>
          (await repository()).findBatchBySession(sessionId, batchId),
        findDocumentsByBatch: async (sessionId, batchId) =>
          (await repository()).findDocumentsByBatch(sessionId, batchId),
        retrieveChunks: ({ abortSignal, ...input }) =>
          retrieveHybridChunks(input, { abortSignal }),
        streamResponse: createChatStreamResponse,
        requestId: () => requestId,
      }),
  );
}
