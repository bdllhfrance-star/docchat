export const supportedFileTypes = [
  "pdf",
  "docx",
  "pptx",
  "xlsx",
  "txt",
  "md",
  "csv",
] as const;

export type SupportedFileType = (typeof supportedFileTypes)[number];

export const documentStatuses = [
  "queued",
  "uploading",
  "validating",
  "extracting",
  "chunking",
  "embedding",
  "indexing",
  "ready",
  "failed",
] as const;

export type DocumentStatus = (typeof documentStatuses)[number];

export type DocumentSource = {
  label: string;
  page?: number;
  slide?: number;
  section?: string;
  sheet?: string;
  cellRange?: string;
  lineStart?: number;
  lineEnd?: number;
};

export type DocumentBlock = {
  text: string;
  source: DocumentSource;
};

export interface DocumentParser {
  supports(fileType: SupportedFileType): boolean;
  extract(content: ArrayBuffer): Promise<DocumentBlock[]>;
}

export type DocumentFailure = {
  code: string;
  message: string;
};

export type DocumentSummary = {
  id: string;
  batchId: string;
  filename: string;
  fileType: SupportedFileType;
  size: number;
  status: DocumentStatus;
  error?: DocumentFailure;
};

export type BatchStatus = "processing" | "ready" | "partial" | "failed";

export type BatchSummary = {
  id: string;
  status: BatchStatus;
  documents: DocumentSummary[];
  createdAt: string;
  expiresAt: string;
};

export type ChunkRecord = {
  id: string;
  batchId: string;
  documentId: string;
  filename: string;
  fileType: SupportedFileType;
  text: string;
  embedding: number[];
  source: DocumentSource;
  chunkIndex: number;
  createdAt: Date;
  expiresAt: Date;
};
