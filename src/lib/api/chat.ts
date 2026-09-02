import { randomUUID } from "node:crypto";

import { z, ZodError } from "zod";

import { apiErrorResponse } from "@/lib/api/errors";
import {
  buildGroundedChatContext,
  getChatDocumentTokenBudget,
  getVectorRetrievalLimit,
} from "@/lib/chat/grounding";
import type { ChatStreamInput } from "@/lib/chat/stream";
import { EmbeddingError } from "@/lib/rag/embeddings";
import {
  type RetrievedChunk,
  VectorRetrievalError,
} from "@/lib/rag/vector-search";
import { MAX_FILES_PER_BATCH } from "@/lib/uploads/validation";
import type { ChatRequest } from "@/types/api";
import type { BatchRecord, DocumentRecord } from "@/types/persistence";

export const MAX_CHAT_REQUEST_BODY_BYTES = 1024 * 1024;

const historyMessageSchema = z
  .object({
    role: z.enum(["user", "assistant"]),
    content: z.string().trim().min(1),
  })
  .strict();

const chatRequestSchema = z
  .object({
    batchId: z.string().uuid(),
    documentIds: z
      .array(z.string().uuid())
      .min(1)
      .max(MAX_FILES_PER_BATCH),
    message: z.string().trim().min(1),
    history: z.array(historyMessageSchema),
  })
  .strict()
  .superRefine((request, context) => {
    if (new Set(request.documentIds).size !== request.documentIds.length) {
      context.addIssue({
        code: "custom",
        message: "DUPLICATE_DOCUMENT_ID",
        path: ["documentIds"],
      });
    }
  });

export type ChatApiDependencies = {
  findBatchBySession: (
    sessionId: string,
    batchId: string,
  ) => Promise<BatchRecord | null>;
  findDocumentsByBatch: (
    sessionId: string,
    batchId: string,
  ) => Promise<DocumentRecord[]>;
  requireSession: () => Promise<string | null>;
  retrieveChunks: (input: {
    sessionId: string;
    batchId: string;
    documentIds: readonly string[];
    query: string;
    limit: number;
    abortSignal?: AbortSignal;
  }) => Promise<RetrievedChunk[]>;
  streamResponse: (input: ChatStreamInput) => Response;
  requestId?: () => string;
};

function invalidBodyResponse(error: ZodError, requestId: string): Response {
  return apiErrorResponse(
    400,
    requestId,
    "INVALID_REQUEST",
    "The chat request is invalid.",
    {
      issues: error.issues.map((issue) => ({
        code: issue.message,
        path: issue.path.map(String).join("."),
      })),
    },
  );
}

function retrievalErrorResponse(error: unknown, requestId: string): Response {
  if (
    error instanceof VectorRetrievalError &&
    error.code === "RETRIEVAL_INVALID_INPUT"
  ) {
    return apiErrorResponse(
      400,
      requestId,
      "INVALID_REQUEST",
      "The retrieval request is invalid.",
    );
  }

  if (error instanceof VectorRetrievalError || error instanceof EmbeddingError) {
    return apiErrorResponse(
      502,
      requestId,
      "PROVIDER_ERROR",
      "The document search could not be completed.",
    );
  }

  return apiErrorResponse(
    500,
    requestId,
    "INTERNAL_ERROR",
    "The chat request could not be completed.",
  );
}

async function parseRequest(
  request: Request,
  requestId: string,
): Promise<ChatRequest | Response> {
  const rawBody = await request.text();

  if (new TextEncoder().encode(rawBody).byteLength > MAX_CHAT_REQUEST_BODY_BYTES) {
    return apiErrorResponse(
      413,
      requestId,
      "PAYLOAD_TOO_LARGE",
      "The chat request is too large.",
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

  try {
    return chatRequestSchema.parse(input);
  } catch (error) {
    return error instanceof ZodError
      ? invalidBodyResponse(error, requestId)
      : apiErrorResponse(
          400,
          requestId,
          "INVALID_REQUEST",
          "The chat request is invalid.",
        );
  }
}

export async function handleChatRequest(
  request: Request,
  dependencies: ChatApiDependencies,
): Promise<Response> {
  const requestId = (dependencies.requestId ?? randomUUID)();

  try {
    const parsed = await parseRequest(request, requestId);

    if (parsed instanceof Response) {
      return parsed;
    }

    const sessionId = await dependencies.requireSession();

    if (!sessionId) {
      return apiErrorResponse(
        401,
        requestId,
        "UNAUTHORIZED_SESSION",
        "A valid session is required.",
      );
    }

    const [batch, documents] = await Promise.all([
      dependencies.findBatchBySession(sessionId, parsed.batchId),
      dependencies.findDocumentsByBatch(sessionId, parsed.batchId),
    ]);

    if (!batch) {
      return apiErrorResponse(404, requestId, "NOT_FOUND", "Batch not found.");
    }

    if (
      batch.status !== "ready" ||
      documents.length !== batch.totalFiles ||
      documents.length === 0 ||
      documents.some((document) => document.status !== "ready")
    ) {
      return apiErrorResponse(
        409,
        requestId,
        "FILE_PROCESSING_FAILED",
        "Every document in the batch must be ready before chatting.",
      );
    }

    const documentsById = new Map(
      documents.map((document) => [document.id, document]),
    );

    if (
      parsed.documentIds.some(
        (documentId) => !documentsById.has(documentId),
      )
    ) {
      return apiErrorResponse(
        404,
        requestId,
        "NOT_FOUND",
        "One or more selected documents were not found.",
      );
    }

    const documentTokenBudget = getChatDocumentTokenBudget(
      parsed.history,
      parsed.message,
    );
    const retrievalLimit = getVectorRetrievalLimit(documentTokenBudget);
    const candidates =
      retrievalLimit === 0
        ? []
        : await dependencies.retrieveChunks({
            sessionId,
            batchId: parsed.batchId,
            documentIds: parsed.documentIds,
            query: parsed.message,
            limit: retrievalLimit,
            abortSignal: request.signal,
          });
    const context = buildGroundedChatContext(
      parsed.message,
      parsed.history,
      candidates,
    );

    return dependencies.streamResponse({
      abortSignal: request.signal,
      context,
      history: parsed.history,
      question: parsed.message,
    });
  } catch (error) {
    return retrievalErrorResponse(error, requestId);
  }
}
