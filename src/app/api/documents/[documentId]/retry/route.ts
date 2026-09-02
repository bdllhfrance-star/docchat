import { handleRetryDocument } from "@/lib/api/document-actions";
import { getBatchRepository } from "@/lib/db/batch-repository";
import { ingestUploadedDocument } from "@/lib/documents/ingestion";
import { getBlobEnv } from "@/lib/env";
import { requireSession } from "@/lib/session-request";
import { downloadPrivateDocument } from "@/lib/uploads/blob-storage";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ documentId: string }>;
};

export async function POST(
  _request: Request,
  context: RouteContext,
): Promise<Response> {
  const { documentId } = await context.params;
  let repositoryPromise: ReturnType<typeof getBatchRepository> | undefined;
  const repository = () => {
    repositoryPromise ??= getBatchRepository();
    return repositoryPromise;
  };

  return handleRetryDocument(documentId, {
    requireSession,
    findDocument: async (sessionId, requestedDocumentId) =>
      (await repository()).findDocumentByIdForSession(
        sessionId,
        requestedDocumentId,
      ),
    restartFailedDocument: async (ownership) =>
      (await repository()).restartFailedDocument(ownership),
    ingestDocument: async (document) => {
      const documentRepository = await repository();
      await ingestUploadedDocument(document, {
        repository: documentRepository,
        loadDocument: (storedDocument) =>
          downloadPrivateDocument(storedDocument, getBlobEnv()),
      });
    },
  });
}
