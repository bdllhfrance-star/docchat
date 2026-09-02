import { randomUUID } from "node:crypto";

import { apiErrorResponse } from "@/lib/api/errors";
import { handleBlobUpload } from "@/lib/api/upload-blob";
import { getBatchRepository } from "@/lib/db/batch-repository";
import { getBlobEnv } from "@/lib/env";
import { requireSession } from "@/lib/session-request";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  try {
    const {
      BLOB_STORE_ID,
      BLOB_WEBHOOK_PUBLIC_KEY,
      VERCEL_OIDC_TOKEN,
    } = getBlobEnv();
    let repositoryPromise: ReturnType<typeof getBatchRepository> | undefined;
    const repository = () => {
      repositoryPromise ??= getBatchRepository();

      return repositoryPromise;
    };

    return handleBlobUpload(request, {
      blob: {
        oidcToken: VERCEL_OIDC_TOKEN,
        storeId: BLOB_STORE_ID,
        webhookPublicKey: BLOB_WEBHOOK_PUBLIC_KEY,
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
