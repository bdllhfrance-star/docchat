import { randomUUID } from "node:crypto";

import { z } from "zod";

import { apiErrorResponse } from "@/lib/api/errors";
import type { BatchStatusResponse } from "@/types/api";
import type { BatchRecord, DocumentRecord } from "@/types/persistence";

const batchIdSchema = z.string().uuid();

export type GetBatchDependencies = {
  requireSession: () => Promise<string | null>;
  findBatchBySession: (
    sessionId: string,
    batchId: string,
  ) => Promise<BatchRecord | null>;
  findDocumentsByBatch: (
    sessionId: string,
    batchId: string,
  ) => Promise<DocumentRecord[]>;
  requestId?: () => string;
};

export async function handleGetBatch(
  batchId: string,
  dependencies: GetBatchDependencies,
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
      return apiErrorResponse(
        404,
        requestId,
        "NOT_FOUND",
        "Batch not found.",
      );
    }

    const documents = await dependencies.findDocumentsByBatch(
      sessionId,
      batchId,
    );
    const response: BatchStatusResponse = {
      batch: {
        id: batch.id,
        status: batch.status,
        documents: documents.map((document) => ({
          id: document.id,
          batchId: document.batchId,
          filename: document.filename,
          fileType: document.fileType,
          size: document.size,
          status: document.status,
          ...(document.error ? { error: document.error } : {}),
        })),
        createdAt: batch.createdAt.toISOString(),
        expiresAt: batch.expiresAt.toISOString(),
      },
    };

    return Response.json(response);
  } catch {
    return apiErrorResponse(
      500,
      requestId,
      "INTERNAL_ERROR",
      "The batch status could not be loaded.",
    );
  }
}
