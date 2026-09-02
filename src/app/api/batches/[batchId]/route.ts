import { randomUUID } from "node:crypto";

import { handleGetBatch } from "@/lib/api/get-batch";
import { observeApiRequest } from "@/lib/api/observability";
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
  const requestId = randomUUID();
  const { batchId } = await context.params;
  let repositoryPromise: ReturnType<typeof getBatchRepository> | undefined;
  const getRepository = () => {
    repositoryPromise ??= getBatchRepository();
    return repositoryPromise;
  };

  return observeApiRequest(
    {
      method: "GET",
      operation: "batch.read",
      requestId,
      route: "/api/batches/:batchId",
    },
    () =>
      handleGetBatch(batchId, {
        requireSession,
        findBatchBySession: async (sessionId, requestedBatchId) =>
          (await getRepository()).findBatchBySession(sessionId, requestedBatchId),
        findDocumentsByBatch: async (sessionId, requestedBatchId) =>
          (await getRepository()).findDocumentsByBatch(
            sessionId,
            requestedBatchId,
          ),
        requestId: () => requestId,
      }),
  );
}
