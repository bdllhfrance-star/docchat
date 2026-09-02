import { handleChatRequest } from "@/lib/api/chat";
import { createChatStreamResponse } from "@/lib/chat/stream";
import { getBatchRepository } from "@/lib/db/batch-repository";
import { retrieveRelevantChunks } from "@/lib/rag/vector-search";
import { requireSession } from "@/lib/session-request";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  let repositoryPromise: ReturnType<typeof getBatchRepository> | undefined;
  const repository = () => {
    repositoryPromise ??= getBatchRepository();
    return repositoryPromise;
  };

  return handleChatRequest(request, {
    requireSession,
    findBatchBySession: async (sessionId, batchId) =>
      (await repository()).findBatchBySession(sessionId, batchId),
    findDocumentsByBatch: async (sessionId, batchId) =>
      (await repository()).findDocumentsByBatch(sessionId, batchId),
    retrieveChunks: ({ abortSignal, ...input }) =>
      retrieveRelevantChunks(input, { abortSignal }),
    streamResponse: createChatStreamResponse,
  });
}
