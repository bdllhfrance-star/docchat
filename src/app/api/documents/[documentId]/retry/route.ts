import { randomUUID } from "node:crypto";

import { handleRetryDocument } from "@/lib/api/document-actions";
import { observeApiRequest } from "@/lib/api/observability";
import { getBatchRepository } from "@/lib/db/batch-repository";
import { ingestUploadedDocument } from "@/lib/documents/ingestion";
import { getBlobEnv } from "@/lib/env";
import { checkRequestRateLimit } from "@/lib/rate-limit";
import { requireSession } from "@/lib/session-request";
import { downloadPrivateDocument } from "@/lib/uploads/blob-storage";

export const runtime = "nodejs";
export const maxDuration = 300;

type RouteContext = {
  params: Promise<{ documentId: string }>;
};

export async function POST(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const requestId = randomUUID();
  const { documentId } = await context.params;
  let repositoryPromise: ReturnType<typeof getBatchRepository> | undefined;
  const repository = () => {
    repositoryPromise ??= getBatchRepository();
    return repositoryPromise;
  };

  return observeApiRequest(
    {
      method: "POST",
      operation: "document.retry",
      requestId,
      route: "/api/documents/:documentId/retry",
    },
    () =>
      handleRetryDocument(documentId, {
        requireSession,
        checkRateLimit: () => checkRequestRateLimit(request, "retry"),
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
            logger: console,
            requestId,
          });
        },
        requestId: () => requestId,
      }),
  );
}
