import { randomUUID } from "node:crypto";

import { ZodError } from "zod";

import { apiErrorResponse } from "@/lib/api/errors";
import { SESSION_TTL_SECONDS } from "@/lib/session";
import { createBlobPathname } from "@/lib/uploads/blob-contract";
import { parseBatchManifest } from "@/lib/uploads/manifest";
import type { RequestSession } from "@/lib/session-request";
import type {
  ApiErrorCode,
  CreateBatchResponse,
  ValidatedBatchManifestFile,
} from "@/types/api";
import type { BatchSummary } from "@/types/documents";
import type { CreatedBatch } from "@/types/persistence";

const maxManifestBodyBytes = 32 * 1024;

export type CreateBatchDependencies = {
  createBatch: (batch: CreatedBatch) => Promise<CreatedBatch>;
  ensureSession: () => Promise<RequestSession>;
  createId?: () => string;
  now?: () => Date;
  requestId?: () => string;
};

function createRecords(
  sessionId: string,
  files: readonly ValidatedBatchManifestFile[],
  createId: () => string,
  now: Date,
): CreatedBatch {
  const batchId = createId();
  const expiresAt = new Date(
    now.getTime() + SESSION_TTL_SECONDS * 1000,
  );
  const documents = files.map((file) => {
    const documentId = createId();

    return {
      id: documentId,
      clientId: file.clientId,
      batchId,
      sessionId,
      filename: file.filename,
      mimeType: file.mimeType,
      fileType: file.fileType,
      blobPathname: createBlobPathname(batchId, documentId, file.fileType),
      size: file.size,
      status: "queued" as const,
      createdAt: now,
      expiresAt,
    };
  });

  return {
    batch: {
      id: batchId,
      sessionId,
      status: "processing",
      totalFiles: documents.length,
      readyFiles: 0,
      failedFiles: 0,
      createdAt: now,
      expiresAt,
    },
    documents,
  };
}

function toBatchSummary(created: CreatedBatch): BatchSummary {
  return {
    id: created.batch.id,
    status: created.batch.status,
    documents: created.documents.map((document) => ({
      id: document.id,
      batchId: document.batchId,
      filename: document.filename,
      fileType: document.fileType,
      size: document.size,
      status: document.status,
      ...(document.error ? { error: document.error } : {}),
    })),
    createdAt: created.batch.createdAt.toISOString(),
    expiresAt: created.batch.expiresAt.toISOString(),
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
    "The batch manifest is invalid.",
    {
      issues: error.issues.map((issue) => ({
        code: issue.message,
        path: issue.path.map(String).join("."),
      })),
    },
  );
}

export async function handleCreateBatch(
  request: Request,
  dependencies: CreateBatchDependencies,
): Promise<Response> {
  const requestId = (dependencies.requestId ?? randomUUID)();

  try {
    const rawBody = await request.text();

    if (new TextEncoder().encode(rawBody).byteLength > maxManifestBodyBytes) {
      return apiErrorResponse(
        413,
        requestId,
        "PAYLOAD_TOO_LARGE",
        "The batch manifest is too large.",
      );
    }

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
    const session = await dependencies.ensureSession();
    const created = createRecords(
      session.sessionId,
      manifest.files,
      dependencies.createId ?? randomUUID,
      (dependencies.now ?? (() => new Date()))(),
    );
    const persisted = await dependencies.createBatch(created);
    const response: CreateBatchResponse = {
      batch: toBatchSummary(persisted),
      files: persisted.documents.map((document) => ({
        clientId: document.clientId,
        documentId: document.id,
        uploadPathname: document.blobPathname,
      })),
    };

    return Response.json(response, { status: 201 });
  } catch (error) {
    if (error instanceof ZodError) {
      return validationErrorResponse(error, requestId);
    }

    return apiErrorResponse(
      500,
      requestId,
      "INTERNAL_ERROR",
      "The batch could not be created.",
    );
  }
}
