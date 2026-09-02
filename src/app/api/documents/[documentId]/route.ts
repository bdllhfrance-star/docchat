import { handleDeleteDocument } from "@/lib/api/document-actions";
import { getBatchRepository } from "@/lib/db/batch-repository";
import { getBlobEnv } from "@/lib/env";
import { requireSession } from "@/lib/session-request";
import { deletePrivateDocument } from "@/lib/uploads/blob-storage";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ documentId: string }>;
};

export async function DELETE(
  _request: Request,
  context: RouteContext,
): Promise<Response> {
  const { documentId } = await context.params;
  let repositoryPromise: ReturnType<typeof getBatchRepository> | undefined;
  const repository = () => {
    repositoryPromise ??= getBatchRepository();
    return repositoryPromise;
  };

  return handleDeleteDocument(documentId, {
    requireSession,
    findDocument: async (sessionId, requestedDocumentId) =>
      (await repository()).findDocumentByIdForSession(
        sessionId,
        requestedDocumentId,
      ),
    deleteBlob: (document) => deletePrivateDocument(document, getBlobEnv()),
    deleteDocument: async (ownership) =>
      (await repository()).deleteDocument(ownership),
  });
}
