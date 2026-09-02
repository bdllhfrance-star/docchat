import type { BatchSummary, DocumentSource } from "@/types/documents";

export const apiErrorCodes = [
  "INVALID_REQUEST",
  "UNAUTHORIZED_SESSION",
  "NOT_FOUND",
  "PAYLOAD_TOO_LARGE",
  "UNSUPPORTED_FILE_TYPE",
  "FILE_PROCESSING_FAILED",
  "RATE_LIMITED",
  "PROVIDER_ERROR",
  "INTERNAL_ERROR",
] as const;

export type ApiErrorCode = (typeof apiErrorCodes)[number];

export type ApiError = {
  error: {
    code: ApiErrorCode;
    message: string;
    requestId: string;
    details?: Record<string, unknown>;
  };
};

export type BatchStatusResponse = {
  batch: BatchSummary;
};

export type ChatRequest = {
  batchId: string;
  documentIds: string[];
  message: string;
};

export type ChatSource = {
  documentId: string;
  filename: string;
  excerpt: string;
  score: number;
  source: DocumentSource;
};
