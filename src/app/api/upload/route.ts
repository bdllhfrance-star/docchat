import { randomUUID } from "node:crypto";

import { apiErrorResponse } from "@/lib/api/errors";
import { handleBlobUpload } from "@/lib/api/upload-blob";
import { getBatchRepository } from "@/lib/db/batch-repository";
import { ingestUploadedDocument } from "@/lib/documents/ingestion";
import { getBlobEnv } from "@/lib/env";
import { requireSession } from "@/lib/session-request";
import { downloadPrivateDocument } from "@/lib/uploads/blob-storage";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  try {
    const blobEnv = getBlobEnv();
    let repositoryPromise: ReturnType<typeof getBatchRepository> | undefined;
    const repository = () => {
      repositoryPromise ??= getBatchRepository();

      return repositoryPromise;
    };

    return handleBlobUpload(request, {
      blob: {
        oidcToken: blobEnv.VERCEL_OIDC_TOKEN,
        storeId: blobEnv.BLOB_STORE_ID,
        webhookPublicKey: blobEnv.BLOB_WEBHOOK_PUBLIC_KEY,
      },
      requireSession,
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
        });
      },
    });
  } catch {
    return apiErrorResponse(
      500,
      randomUUID(),
      "INTERNAL_ERROR",
      "The upload service is not configured.",
    );
  }
}
