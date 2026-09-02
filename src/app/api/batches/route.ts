import { handleCreateBatch } from "@/lib/api/create-batch";
import { getBatchRepository } from "@/lib/db/batch-repository";
import { ensureSession } from "@/lib/session-request";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  return handleCreateBatch(request, {
    ensureSession,
    createBatch: async (created) => {
      const repository = await getBatchRepository();

      return repository.createBatch(created);
    },
  });
}
