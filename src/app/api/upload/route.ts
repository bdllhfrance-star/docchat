import { randomUUID } from "node:crypto";

import { apiErrorResponse } from "@/lib/api/errors";
import { observeApiRequest } from "@/lib/api/observability";
import { handleBlobUpload } from "@/lib/api/upload-blob";
import { getBatchRepository } from "@/lib/db/batch-repository";
import { ingestUploadedDocument } from "@/lib/documents/ingestion";
import { getBlobEnv } from "@/lib/env";
import { checkRequestRateLimit } from "@/lib/rate-limit";
import { requireSession } from "@/lib/session-request";
import { downloadPrivateDocument } from "@/lib/uploads/blob-storage";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const requestId = randomUUID();

  return observeApiRequest(
    {
      method: "POST",
      operation: "document.upload",
      requestId,
      route: "/api/upload",
    },
    async () => {
      try {
        const blobEnv = getBlobEnv();
        let repositoryPromise: ReturnType<typeof getBatchRepository> | undefined;
        const repository = () => {
          repositoryPromise ??= getBatchRepository();

          return repositoryPromise;
        };

        return handleBlobUpload(request, {
          blob: {
            token: blobEnv.BLOB_READ_WRITE_TOKEN,
          },
          requireSession,
          checkRateLimit: () => checkRequestRateLimit(request, "upload"),
          findDocumentBySession: async (sessionId, batchId, documentId) =>
            (await repository()).findDocumentBySession(
              sessionId,
              batchId,
              documentId,
            ),
          markDocumentUploading: async (ownership) =>
            (await repository()).markDocumentUploading(ownership),
          failDocumentUpload: async (failure) =>
            (await repository()).failDocumentUpload(failure),
          completeDocumentUpload: async (upload) =>
            (await repository()).completeDocumentUpload(upload),
          ingestDocument: async (document) => {
            await ingestUploadedDocument(document, {
              repository: await repository(),
              loadDocument: (storedDocument) =>
                downloadPrivateDocument(storedDocument, blobEnv),
              logger: console,
              requestId,
            });
          },
          requestId: () => requestId,
        });
      } catch {
        return apiErrorResponse(
          500,
          requestId,
          "INTERNAL_ERROR",
          "The upload service is not configured.",
        );
      }
    },
  );
}
