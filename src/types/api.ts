import type {
  BatchSummary,
  DocumentSummary,
  DocumentSource,
  SupportedFileType,
} from "@/types/documents";

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

export type BatchManifestFile = {
  clientId: string;
  filename: string;
  size: number;
  mimeType: string;
};

export type ValidatedBatchManifestFile = BatchManifestFile & {
  fileType: SupportedFileType;
};

export type CreateBatchRequest = {
  files: BatchManifestFile[];
};

export type CreateBatchFile = {
  clientId: string;
  documentId: string;
  uploadPathname: string;
};

export type CreateBatchResponse = BatchStatusResponse & {
  files: CreateBatchFile[];
};

export type BlobUploadClientPayload = {
  batchId: string;
  documentId: string;
};

export type ReportUploadFailureRequest = {
  type: "docchat.upload-failed";
  payload: BlobUploadClientPayload;
};

export type RetryDocumentResponse = {
  document: DocumentSummary;
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
