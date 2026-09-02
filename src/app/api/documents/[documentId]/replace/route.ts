import { handleReplaceDocument } from "@/lib/api/replace-document";
import { getBatchRepository } from "@/lib/db/batch-repository";
import { getBlobEnv } from "@/lib/env";
import { requireSession } from "@/lib/session-request";
import { deletePrivateDocument } from "@/lib/uploads/blob-storage";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ documentId: string }>;
};

export async function POST(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const { documentId } = await context.params;
  let repositoryPromise: ReturnType<typeof getBatchRepository> | undefined;
  const repository = () => {
    repositoryPromise ??= getBatchRepository();
    return repositoryPromise;
  };

  return handleReplaceDocument(request, documentId, {
    requireSession,
    findDocument: async (sessionId, requestedDocumentId) =>
      (await repository()).findDocumentByIdForSession(
        sessionId,
        requestedDocumentId,
      ),
    findDocumentsByBatch: async (sessionId, batchId) =>
      (await repository()).findDocumentsByBatch(sessionId, batchId),
    prepareDocumentReplacement: async (replacement) =>
      (await repository()).prepareDocumentReplacement(replacement),
    restoreDocumentReplacement: async (restoration) =>
      (await repository()).restoreDocumentReplacement(restoration),
    deleteBlob: (document) => deletePrivateDocument(document, getBlobEnv()),
  });
}
