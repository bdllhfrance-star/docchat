import { randomUUID } from "node:crypto";

import { z, ZodError } from "zod";

import { apiErrorResponse } from "@/lib/api/errors";
import {
  readBoundedRequestText,
  RequestBodyTooLargeError,
} from "@/lib/api/request-body";
import type { AppendDocuments } from "@/lib/db/batch-repository";
import {
  assertRateLimit,
  type RateLimitCheck,
  RateLimitExceededError,
  rateLimitErrorResponse,
} from "@/lib/rate-limit";
import { createBlobPathname } from "@/lib/uploads/blob-contract";
import { parseBatchManifest } from "@/lib/uploads/manifest";
import {
  MAX_BATCH_SIZE_BYTES,
  MAX_FILES_PER_BATCH,
} from "@/lib/uploads/validation";
import type {
  AddBatchDocumentsResponse,
  ApiErrorCode,
  ValidatedBatchManifestFile,
} from "@/types/api";
import type { BatchRecord, DocumentRecord } from "@/types/persistence";

const batchIdSchema = z.string().uuid();
const maxManifestBodyBytes = 32 * 1024;

export type AddBatchDocumentsDependencies = {
  appendDocuments: (
    addition: AppendDocuments,
  ) => Promise<DocumentRecord[] | null>;
  checkRateLimit?: RateLimitCheck;
  createId?: () => string;
  findBatchBySession: (
    sessionId: string,
    batchId: string,
  ) => Promise<BatchRecord | null>;
  findDocumentsByBatch: (
    sessionId: string,
    batchId: string,
  ) => Promise<DocumentRecord[]>;
  now?: () => Date;
  requestId?: () => string;
  requireSession: () => Promise<string | null>;
};

function validationErrorResponse(error: ZodError, requestId: string): Response {
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
    "The document manifest is invalid.",
    {
      issues: error.issues.map((issue) => ({
        code: issue.message,
        path: issue.path.map(String).join("."),
      })),
    },
  );
}

function createDocumentRecords(
  batch: BatchRecord,
  files: readonly ValidatedBatchManifestFile[],
  createId: () => string,
  now: Date,
): DocumentRecord[] {
  return files.map((file) => {
    const documentId = createId();

    return {
      id: documentId,
      clientId: file.clientId,
      batchId: batch.id,
      sessionId: batch.sessionId,
      filename: file.filename,
      mimeType: file.mimeType,
      fileType: file.fileType,
      blobPathname: createBlobPathname(batch.id, documentId, file.fileType),
      size: file.size,
      status: "queued",
      createdAt: now,
      expiresAt: batch.expiresAt,
    };
  });
}

function toDocumentSummary(document: DocumentRecord) {
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

export async function handleAddBatchDocuments(
  request: Request,
  batchId: string,
  dependencies: AddBatchDocumentsDependencies,
): Promise<Response> {
  const requestId = (dependencies.requestId ?? randomUUID)();

  if (!batchIdSchema.safeParse(batchId).success) {
    return apiErrorResponse(
      400,
      requestId,
      "INVALID_REQUEST",
      "The batch identifier is invalid.",
    );
  }

  try {
    const rawBody = await readBoundedRequestText(request, maxManifestBodyBytes);
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

    const manifest = parseBatchManifest(input);
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

    const batch = await dependencies.findBatchBySession(sessionId, batchId);

    if (!batch) {
      return apiErrorResponse(404, requestId, "NOT_FOUND", "Batch not found.");
    }

    const existingDocuments = await dependencies.findDocumentsByBatch(
      sessionId,
      batchId,
    );

    if (
      existingDocuments.some(
        (document) =>
          document.status !== "ready" && document.status !== "failed",
      )
    ) {
      return apiErrorResponse(
        409,
        requestId,
        "INVALID_REQUEST",
        "Wait for the current documents to finish processing.",
      );
    }

    const totalFiles = existingDocuments.length + manifest.files.length;
    const totalSize =
      existingDocuments.reduce((sum, document) => sum + document.size, 0) +
      manifest.files.reduce((sum, file) => sum + file.size, 0);

    if (totalFiles > MAX_FILES_PER_BATCH) {
      return apiErrorResponse(
        413,
        requestId,
        "PAYLOAD_TOO_LARGE",
        `A session can contain at most ${MAX_FILES_PER_BATCH} documents.`,
      );
    }

    if (totalSize > MAX_BATCH_SIZE_BYTES) {
      return apiErrorResponse(
        413,
        requestId,
        "PAYLOAD_TOO_LARGE",
        "The documents exceed the 50 MiB session limit.",
      );
    }

    const documents = createDocumentRecords(
      batch,
      manifest.files,
      dependencies.createId ?? randomUUID,
      (dependencies.now ?? (() => new Date()))(),
    );
    const appended = await dependencies.appendDocuments({
      batchId,
      documents,
      sessionId,
    });

    if (!appended) {
      return apiErrorResponse(404, requestId, "NOT_FOUND", "Batch not found.");
    }

    const response: AddBatchDocumentsResponse = {
      batch: {
        id: batch.id,
        status: "processing",
        documents: [...existingDocuments, ...appended].map(toDocumentSummary),
        createdAt: batch.createdAt.toISOString(),
        expiresAt: batch.expiresAt.toISOString(),
      },
      files: appended.map((document) => ({
        clientId: document.clientId,
        documentId: document.id,
        uploadPathname: document.blobPathname,
      })),
    };

    return Response.json(response, { status: 201 });
  } catch (error) {
    if (error instanceof RateLimitExceededError) {
      return rateLimitErrorResponse(error, requestId);
    }

    if (error instanceof RequestBodyTooLargeError) {
      return apiErrorResponse(
        413,
        requestId,
        "PAYLOAD_TOO_LARGE",
        "The document manifest is too large.",
      );
    }

    if (error instanceof ZodError) {
      return validationErrorResponse(error, requestId);
    }

    return apiErrorResponse(
      500,
      requestId,
      "INTERNAL_ERROR",
      "The context could not be updated.",
    );
  }
}
