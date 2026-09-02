import type {
  BatchStatus,
  DocumentFailure,
  DocumentStatus,
  SupportedFileType,
} from "@/types/documents";

export type BatchRecord = {
  id: string;
  sessionId: string;
  status: BatchStatus;
  totalFiles: number;
  readyFiles: number;
  failedFiles: number;
  createdAt: Date;
  expiresAt: Date;
};

export type DocumentRecord = {
  id: string;
  clientId: string;
  batchId: string;
  sessionId: string;
  filename: string;
  mimeType: string;
  fileType: SupportedFileType;
  blobPathname: string;
  blobUrl?: string;
  size: number;
  status: DocumentStatus;
  error?: DocumentFailure;
  createdAt: Date;
  expiresAt: Date;
};

export type CreatedBatch = {
  batch: BatchRecord;
  documents: DocumentRecord[];
};
