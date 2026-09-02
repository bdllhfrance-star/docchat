import { randomUUID } from "node:crypto";

import { handleAddBatchDocuments } from "@/lib/api/add-batch-documents";
import { observeApiRequest } from "@/lib/api/observability";
import { getBatchRepository } from "@/lib/db/batch-repository";
import { checkRequestRateLimit } from "@/lib/rate-limit";
import { requireSession } from "@/lib/session-request";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ batchId: string }>;
};

export async function POST(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const requestId = randomUUID();
  const { batchId } = await context.params;
  let repositoryPromise: ReturnType<typeof getBatchRepository> | undefined;
  const repository = () => {
    repositoryPromise ??= getBatchRepository();
    return repositoryPromise;
  };

  return observeApiRequest(
    {
      method: "POST",
      operation: "batch.documents.add",
      requestId,
      route: "/api/batches/:batchId/documents",
    },
    () =>
      handleAddBatchDocuments(request, batchId, {
        requireSession,
        checkRateLimit: () => checkRequestRateLimit(request, "upload"),
        findBatchBySession: async (sessionId, requestedBatchId) =>
          (await repository()).findBatchBySession(sessionId, requestedBatchId),
        findDocumentsByBatch: async (sessionId, requestedBatchId) =>
          (await repository()).findDocumentsByBatch(
            sessionId,
            requestedBatchId,
          ),
        appendDocuments: async (addition) =>
          (await repository()).appendDocuments(addition),
        requestId: () => requestId,
      }),
  );
}
