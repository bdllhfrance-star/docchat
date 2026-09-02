import { handleGetBatch } from "@/lib/api/get-batch";
import { getBatchRepository } from "@/lib/db/batch-repository";
import { requireSession } from "@/lib/session-request";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ batchId: string }>;
};

export async function GET(
  _request: Request,
  context: RouteContext,
): Promise<Response> {
  const { batchId } = await context.params;
  let repositoryPromise: ReturnType<typeof getBatchRepository> | undefined;
  const getRepository = () => {
    repositoryPromise ??= getBatchRepository();
    return repositoryPromise;
  };

  return handleGetBatch(batchId, {
    requireSession,
    findBatchBySession: async (sessionId, requestedBatchId) =>
      (await getRepository()).findBatchBySession(sessionId, requestedBatchId),
    findDocumentsByBatch: async (sessionId, requestedBatchId) =>
      (await getRepository()).findDocumentsByBatch(sessionId, requestedBatchId),
  });
}
