import { randomUUID } from "node:crypto";

import type { DocumentChunk } from "@/lib/rag/chunking";
import { chunkDocumentBlocks } from "@/lib/rag/chunking";
import {
  embedDocumentChunks,
  EmbeddingError,
  type EmbeddedDocumentChunk,
} from "@/lib/rag/embeddings";
import { BlobDownloadError } from "@/lib/uploads/blob-storage";
import type {
  ChunkRecord,
  DocumentBlock,
  DocumentStatus,
} from "@/types/documents";
import type { DocumentRecord } from "@/types/persistence";

import { pdfParser, PdfExtractionError } from "./pdf-parser";

type Ownership = {
  sessionId: string;
  batchId: string;
  documentId: string;
};

type IngestionRepository = {
  transitionDocumentStatus: (
    ownership: Ownership,
    from: DocumentStatus,
    to: DocumentStatus,
  ) => Promise<DocumentRecord | null>;
  failDocumentProcessing: (
    failure: Ownership & {
      error: { code: string; message: string };
    },
  ) => Promise<DocumentRecord | null>;
  completeDocumentIndexing: (
    completion: Ownership & { chunks: ChunkRecord[] },
  ) => Promise<DocumentRecord | null>;
};

export type DocumentIngestionDependencies = {
  repository: IngestionRepository;
  loadDocument: (document: DocumentRecord) => Promise<ArrayBuffer>;
  extract?: (content: ArrayBuffer) => Promise<DocumentBlock[]>;
  chunk?: (blocks: readonly DocumentBlock[]) => DocumentChunk[];
  embed?: (
    chunks: readonly DocumentChunk[],
  ) => Promise<EmbeddedDocumentChunk[]>;
  createId?: () => string;
  now?: () => Date;
};

export type DocumentIngestionResult =
  | { outcome: "ready"; document: DocumentRecord }
  | { outcome: "failed"; document: DocumentRecord }
  | { outcome: "skipped" };

class IngestionStateError extends Error {
  readonly code = "INGESTION_STATE_CONFLICT";
}

class ParserNotAvailableError extends Error {
  readonly code = "PARSER_NOT_AVAILABLE";
}

function ownership(document: DocumentRecord): Ownership {
  return {
    sessionId: document.sessionId,
    batchId: document.batchId,
    documentId: document.id,
  };
}

function processingFailure(error: unknown): { code: string; message: string } {
  if (
    error instanceof PdfExtractionError ||
    error instanceof EmbeddingError ||
    error instanceof BlobDownloadError ||
    error instanceof IngestionStateError ||
    error instanceof ParserNotAvailableError
  ) {
    return { code: error.code, message: error.message };
  }

  return {
    code: "DOCUMENT_PROCESSING_FAILED",
    message: "The document could not be processed.",
  };
}

async function moveTo(
  repository: IngestionRepository,
  documentOwnership: Ownership,
  from: DocumentStatus,
  to: DocumentStatus,
): Promise<void> {
  const transitioned = await repository.transitionDocumentStatus(
    documentOwnership,
    from,
    to,
  );

  if (!transitioned) {
    throw new IngestionStateError(
      `The document could not transition from ${from} to ${to}.`,
    );
  }
}

function createChunkRecords(
  document: DocumentRecord,
  chunks: readonly EmbeddedDocumentChunk[],
  createId: () => string,
  createdAt: Date,
): ChunkRecord[] {
  return chunks.map((chunk) => ({
    id: createId(),
    sessionId: document.sessionId,
    batchId: document.batchId,
    documentId: document.id,
    filename: document.filename,
    fileType: document.fileType,
    text: chunk.text,
    embedding: chunk.embedding,
    source: chunk.source,
    chunkIndex: chunk.chunkIndex,
    createdAt,
    expiresAt: document.expiresAt,
  }));
}

export async function ingestUploadedDocument(
  document: DocumentRecord,
  dependencies: DocumentIngestionDependencies,
): Promise<DocumentIngestionResult> {
  if (document.status !== "validating") {
    return { outcome: "skipped" };
  }

  const documentOwnership = ownership(document);

  try {
    if (document.fileType !== "pdf") {
      throw new ParserNotAvailableError(
        `The ${document.fileType.toUpperCase()} parser is not available yet.`,
      );
    }

    const content = await dependencies.loadDocument(document);
    const extracting = await dependencies.repository.transitionDocumentStatus(
      documentOwnership,
      "validating",
      "extracting",
    );

    if (!extracting) {
      return { outcome: "skipped" };
    }

    const blocks = await (dependencies.extract ?? pdfParser.extract)(content);
    await moveTo(
      dependencies.repository,
      documentOwnership,
      "extracting",
      "chunking",
    );

    const chunks = (dependencies.chunk ?? chunkDocumentBlocks)(blocks);
    await moveTo(
      dependencies.repository,
      documentOwnership,
      "chunking",
      "embedding",
    );

    const embedded = await (dependencies.embed ?? embedDocumentChunks)(chunks);
    await moveTo(
      dependencies.repository,
      documentOwnership,
      "embedding",
      "indexing",
    );

    const ready = await dependencies.repository.completeDocumentIndexing({
      ...documentOwnership,
      chunks: createChunkRecords(
        document,
        embedded,
        dependencies.createId ?? randomUUID,
        (dependencies.now ?? (() => new Date()))(),
      ),
    });

    if (!ready) {
      throw new IngestionStateError(
        "The indexed document could not be marked ready.",
      );
    }

    return { outcome: "ready", document: ready };
  } catch (error) {
    const failed = await dependencies.repository.failDocumentProcessing({
      ...documentOwnership,
      error: processingFailure(error),
    });

    return failed
      ? { outcome: "failed", document: failed }
      : { outcome: "skipped" };
  }
}
