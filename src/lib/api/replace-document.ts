import { randomUUID } from "node:crypto";

import { ZodError, z } from "zod";

import { apiErrorResponse } from "@/lib/api/errors";
import {
  readBoundedRequestText,
  RequestBodyTooLargeError,
} from "@/lib/api/request-body";
import type {
  PrepareDocumentReplacement,
  RestoreDocumentReplacement,
} from "@/lib/db/batch-repository";
import { createBlobPathname } from "@/lib/uploads/blob-contract";
import { parseBatchManifest } from "@/lib/uploads/manifest";
import { MAX_BATCH_SIZE_BYTES } from "@/lib/uploads/validation";
import {
  assertRateLimit,
  type RateLimitCheck,
  RateLimitExceededError,
  rateLimitErrorResponse,
} from "@/lib/rate-limit";
import type {
  ApiErrorCode,
  ReplaceDocumentResponse,
} from "@/types/api";
import type { DocumentSummary } from "@/types/documents";
import type { DocumentRecord } from "@/types/persistence";

const documentIdSchema = z.string().uuid();
const maxReplacementBodyBytes = 32 * 1024;

export type ReplaceDocumentDependencies = {
  deleteBlob: (document: DocumentRecord) => Promise<void>;
  findDocument: (
    sessionId: string,
    documentId: string,
  ) => Promise<DocumentRecord | null>;
  findDocumentsByBatch: (
    sessionId: string,
    batchId: string,
  ) => Promise<DocumentRecord[]>;
  prepareDocumentReplacement: (
    replacement: PrepareDocumentReplacement,
  ) => Promise<DocumentRecord | null>;
  requireSession: () => Promise<string | null>;
  restoreDocumentReplacement: (
    restoration: RestoreDocumentReplacement,
  ) => Promise<DocumentRecord | null>;
  requestId?: () => string;
  checkRateLimit?: RateLimitCheck;
};

function toDocumentSummary(document: DocumentRecord): DocumentSummary {
  return {
    id: document.id,
    batchId: document.batchId,
    filename: document.filename,
    fileType: document.fileType,
    size: document.size,
    status: document.status,
    canRetry: document.status === "failed" && Boolean(document.blobUrl),
    ...(document.error ? { error: document.error } : {}),
  };
}

function validationErrorResponse(
  error: ZodError,
  requestId: string,
): Response {
  const issueCodes = error.issues.map((issue) => issue.message);
  let status = 400;
  let code: ApiErrorCode = "INVALID_REQUEST";

  if (
    issueCodes.includes("FILE_TOO_LARGE") ||
    issueCodes.includes("BATCH_TOO_LARGE")
  ) {
    status = 413;
    code = "PAYLOAD_TOO_LARGE";
  } else if (issueCodes.includes("UNSUPPORTED_FILE_TYPE")) {
    status = 415;
    code = "UNSUPPORTED_FILE_TYPE";
  }

  return apiErrorResponse(
    status,
    requestId,
    code,
    "The replacement file is invalid.",
    {
      issues: error.issues.map((issue) => ({
        code: issue.message,
        path: issue.path.map(String).join(".").replace(/^files\.0\.?/, ""),
      })),
    },
  );
}

export async function handleReplaceDocument(
  request: Request,
  documentId: string,
  dependencies: ReplaceDocumentDependencies,
): Promise<Response> {
  const requestId = (dependencies.requestId ?? randomUUID)();

  if (!documentIdSchema.safeParse(documentId).success) {
    return apiErrorResponse(
      400,
      requestId,
      "INVALID_REQUEST",
      "The document identifier is invalid.",
    );
  }

  try {
    const rawBody = await readBoundedRequestText(
      request,
      maxReplacementBodyBytes,
    );

    let input: unknown;

    try {
      input = JSON.parse(rawBody);
    } catch {
      return apiErrorResponse(
        400,
        requestId,
        "INVALID_REQUEST",
        "The request body must be valid JSON.",
      );
    }

    const replacement = parseBatchManifest({ files: [input] }).files[0];
    await assertRateLimit(dependencies.checkRateLimit);
    const sessionId = await dependencies.requireSession();

    if (!sessionId) {
      return apiErrorResponse(
        401,
        requestId,
        "UNAUTHORIZED_SESSION",
        "A valid session is required.",
      );
    }

    const original = await dependencies.findDocument(sessionId, documentId);

    if (!original) {
      return apiErrorResponse(404, requestId, "NOT_FOUND", "Document not found.");
    }

    if (original.status !== "failed") {
      return apiErrorResponse(
        409,
        requestId,
        "INVALID_REQUEST",
        "Only a failed document can be replaced.",
      );
    }

    const batchDocuments = await dependencies.findDocumentsByBatch(
      sessionId,
      original.batchId,
    );
    const replacementBatchSize =
      replacement.size +
      batchDocuments.reduce(
        (total, document) =>
          document.id === documentId ? total : total + document.size,
        0,
      );

    if (replacementBatchSize > MAX_BATCH_SIZE_BYTES) {
      return apiErrorResponse(
        413,
        requestId,
        "PAYLOAD_TOO_LARGE",
        "The replacement would exceed the 50 MiB batch limit.",
      );
    }

    const uploadPathname = createBlobPathname(
      original.batchId,
      documentId,
      replacement.fileType,
    );
    const prepared = await dependencies.prepareDocumentReplacement({
      sessionId,
      batchId: original.batchId,
      documentId,
      ...replacement,
      blobPathname: uploadPathname,
    });

    if (!prepared) {
      return apiErrorResponse(
        409,
        requestId,
        "INVALID_REQUEST",
        "The document could not be replaced from its current state.",
      );
    }

    if (original.blobUrl) {
      try {
        await dependencies.deleteBlob(original);
      } catch {
        await dependencies
          .restoreDocumentReplacement({
            sessionId,
            batchId: original.batchId,
            documentId,
            replacementClientId: replacement.clientId,
            original,
          })
          .catch(() => null);

        return apiErrorResponse(
          502,
          requestId,
          "PROVIDER_ERROR",
          "The previous stored file could not be removed.",
        );
      }
    }

    const body: ReplaceDocumentResponse = {
      document: toDocumentSummary(prepared),
      uploadPathname,
    };

    return Response.json(body);
  } catch (error) {
    if (error instanceof RateLimitExceededError) {
      return rateLimitErrorResponse(error, requestId);
    }

    if (error instanceof RequestBodyTooLargeError) {
      return apiErrorResponse(
        413,
        requestId,
        "PAYLOAD_TOO_LARGE",
        "The replacement manifest is too large.",
      );
    }

    if (error instanceof ZodError) {
      return validationErrorResponse(error, requestId);
    }

    return apiErrorResponse(
      500,
      requestId,
      "INTERNAL_ERROR",
      "The document could not be replaced.",
    );
  }
}
