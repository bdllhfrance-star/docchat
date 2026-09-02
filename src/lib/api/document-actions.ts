import { randomUUID } from "node:crypto";

import { z } from "zod";

import { apiErrorResponse } from "@/lib/api/errors";
import type { DeleteDocumentResult } from "@/lib/db/batch-repository";
import {
  assertRateLimit,
  type RateLimitCheck,
  RateLimitExceededError,
  rateLimitErrorResponse,
} from "@/lib/rate-limit";
import type { RetryDocumentResponse } from "@/types/api";
import type { DocumentStatus, DocumentSummary } from "@/types/documents";
import type { DocumentRecord } from "@/types/persistence";

const documentIdSchema = z.string().uuid();
const retryInProgressStatuses = new Set<DocumentStatus>([
  "validating",
  "extracting",
  "chunking",
  "embedding",
  "indexing",
]);

type FindDocument = (
  sessionId: string,
  documentId: string,
) => Promise<DocumentRecord | null>;

type BaseDocumentActionDependencies = {
  findDocument: FindDocument;
  requireSession: () => Promise<string | null>;
  requestId?: () => string;
};

export type RetryDocumentDependencies = BaseDocumentActionDependencies & {
  checkRateLimit?: RateLimitCheck;
  ingestDocument: (document: DocumentRecord) => Promise<void>;
  restartFailedDocument: (
    ownership: DocumentOwnership,
  ) => Promise<DocumentRecord | null>;
};

export type DeleteDocumentDependencies = BaseDocumentActionDependencies & {
  deleteBlob: (document: DocumentRecord) => Promise<void>;
  deleteDocument: (
    ownership: DocumentOwnership,
  ) => Promise<DeleteDocumentResult>;
};

type DocumentOwnership = {
  sessionId: string;
  batchId: string;
  documentId: string;
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

function retryResponse(document: DocumentRecord): Response {
  const body: RetryDocumentResponse = {
    document: toDocumentSummary(document),
  };
  const status = retryInProgressStatuses.has(document.status) ? 202 : 200;

  return Response.json(body, { status });
}

function invalidIdResponse(requestId: string): Response {
  return apiErrorResponse(
    400,
    requestId,
    "INVALID_REQUEST",
    "The document identifier is invalid.",
  );
}

async function requireDocument(
  documentId: string,
  dependencies: BaseDocumentActionDependencies,
  requestId: string,
): Promise<{ document: DocumentRecord; sessionId: string } | Response> {
  const sessionId = await dependencies.requireSession();

  if (!sessionId) {
    return apiErrorResponse(
      401,
      requestId,
      "UNAUTHORIZED_SESSION",
      "A valid session is required.",
    );
  }

  const document = await dependencies.findDocument(sessionId, documentId);

  if (!document) {
    return apiErrorResponse(404, requestId, "NOT_FOUND", "Document not found.");
  }

  return { document, sessionId };
}

export async function handleRetryDocument(
  documentId: string,
  dependencies: RetryDocumentDependencies,
): Promise<Response> {
  const requestId = (dependencies.requestId ?? randomUUID)();

  if (!documentIdSchema.safeParse(documentId).success) {
    return invalidIdResponse(requestId);
  }

  try {
    await assertRateLimit(dependencies.checkRateLimit);
    const found = await requireDocument(documentId, dependencies, requestId);

    if (found instanceof Response) {
      return found;
    }

    const { document, sessionId } = found;

    if (
      document.status === "ready" ||
      retryInProgressStatuses.has(document.status)
    ) {
      return retryResponse(document);
    }

    if (document.status !== "failed" || !document.blobUrl) {
      return apiErrorResponse(
        409,
        requestId,
        "INVALID_REQUEST",
        "The uploaded original is unavailable. Replace or remove this document.",
      );
    }

    const ownership = {
      sessionId,
      batchId: document.batchId,
      documentId,
    };
    const restarted = await dependencies.restartFailedDocument(ownership);

    if (!restarted) {
      const current = await dependencies.findDocument(sessionId, documentId);

      if (
        current &&
        (current.status === "ready" ||
          retryInProgressStatuses.has(current.status))
      ) {
        return retryResponse(current);
      }

      return apiErrorResponse(
        409,
        requestId,
        "INVALID_REQUEST",
        "The document could not be restarted from its current state.",
      );
    }

    await dependencies.ingestDocument(restarted);
    const processed = await dependencies.findDocument(sessionId, documentId);

    return processed
      ? retryResponse(processed)
      : apiErrorResponse(404, requestId, "NOT_FOUND", "Document not found.");
  } catch (error) {
    if (error instanceof RateLimitExceededError) {
      return rateLimitErrorResponse(error, requestId);
    }

    return apiErrorResponse(
      500,
      requestId,
      "INTERNAL_ERROR",
      "The document could not be retried.",
    );
  }
}

export async function handleDeleteDocument(
  documentId: string,
  dependencies: DeleteDocumentDependencies,
): Promise<Response> {
  const requestId = (dependencies.requestId ?? randomUUID)();

  if (!documentIdSchema.safeParse(documentId).success) {
    return invalidIdResponse(requestId);
  }

  try {
    const found = await requireDocument(documentId, dependencies, requestId);

    if (found instanceof Response) {
      return found;
    }

    const { document, sessionId } = found;

    if (document.status !== "ready" && document.status !== "failed") {
      return apiErrorResponse(
        409,
        requestId,
        "INVALID_REQUEST",
        "A document can only be removed after processing has finished.",
      );
    }

    if (document.blobUrl) {
      try {
        await dependencies.deleteBlob(document);
      } catch {
        return apiErrorResponse(
          502,
          requestId,
          "PROVIDER_ERROR",
          "The stored file could not be removed.",
        );
      }
    }

    const deletion = await dependencies.deleteDocument({
      sessionId,
      batchId: document.batchId,
      documentId,
    });

    if (!deletion.deleted) {
      const current = await dependencies.findDocument(sessionId, documentId);

      if (current) {
        return apiErrorResponse(
          500,
          requestId,
          "INTERNAL_ERROR",
          "The document metadata could not be removed.",
        );
      }
    }

    return new Response(null, { status: 204 });
  } catch {
    return apiErrorResponse(
      500,
      requestId,
      "INTERNAL_ERROR",
      "The document could not be removed.",
    );
  }
}
