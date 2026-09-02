import { randomUUID } from "node:crypto";

import { handleReplaceDocument } from "@/lib/api/replace-document";
import { observeApiRequest } from "@/lib/api/observability";
import { getBatchRepository } from "@/lib/db/batch-repository";
import { getBlobEnv } from "@/lib/env";
import { checkRequestRateLimit } from "@/lib/rate-limit";
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
      operation: "document.replace",
      requestId,
      route: "/api/documents/:documentId/replace",
    },
    () =>
      handleReplaceDocument(request, documentId, {
        requireSession,
        checkRateLimit: () => checkRequestRateLimit(request, "upload"),
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
        requestId: () => requestId,
      }),
  );
}
