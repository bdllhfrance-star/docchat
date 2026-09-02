import { randomUUID } from "node:crypto";

import { handleCreateBatch } from "@/lib/api/create-batch";
import { observeApiRequest } from "@/lib/api/observability";
import { getBatchRepository } from "@/lib/db/batch-repository";
import { checkRequestRateLimit } from "@/lib/rate-limit";
import { ensureSession } from "@/lib/session-request";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const requestId = randomUUID();

  return observeApiRequest(
    {
      method: "POST",
      operation: "batch.create",
      requestId,
      route: "/api/batches",
    },
    () =>
      handleCreateBatch(request, {
        ensureSession,
        checkRateLimit: () => checkRequestRateLimit(request, "upload"),
        createBatch: async (created) => {
          const repository = await getBatchRepository();

          return repository.createBatch(created);
        },
        requestId: () => requestId,
      }),
  );
}
