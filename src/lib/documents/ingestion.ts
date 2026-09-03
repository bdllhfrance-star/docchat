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

import { DocumentExtractionError } from "./parser-error";
import { getDocumentParser } from "./parser-registry";
import { PdfExtractionError } from "./pdf-parser";

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
  logger?: Pick<Console, "info" | "warn">;
  now?: () => Date;
  requestId?: string;
};

export type DocumentIngestionResult =
  | { outcome: "ready"; document: DocumentRecord }
  | { outcome: "failed"; document: DocumentRecord }
  | { outcome: "skipped" };

type IngestionStage =
  | "download"
  | "extract"
  | "chunk"
  | "embed"
  | "index";

type IngestionTiming = {
  stageDurationsMs: Partial<Record<IngestionStage, number>>;
  totalDurationMs: number;
};

class IngestionStateError extends Error {
  readonly code = "INGESTION_STATE_CONFLICT";
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
    error instanceof DocumentExtractionError ||
    error instanceof EmbeddingError ||
    error instanceof BlobDownloadError ||
    error instanceof IngestionStateError
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

function logIngestion(
  document: DocumentRecord,
  dependencies: DocumentIngestionDependencies,
  outcome: "ready" | "failed",
  timing: IngestionTiming,
  errorCode?: string,
): void {
  const entry = JSON.stringify({
    timestamp: new Date().toISOString(),
    level: outcome === "ready" ? "info" : "warn",
    event:
      outcome === "ready"
        ? "document.ingestion.completed"
        : "document.ingestion.failed",
    ...(dependencies.requestId ? { requestId: dependencies.requestId } : {}),
    batchId: document.batchId,
    documentId: document.id,
    fileType: document.fileType,
    outcome,
    ...timing,
    ...(errorCode ? { errorCode } : {}),
  });

  dependencies.logger?.[outcome === "ready" ? "info" : "warn"](entry);
}

export async function ingestUploadedDocument(
  document: DocumentRecord,
  dependencies: DocumentIngestionDependencies,
): Promise<DocumentIngestionResult> {
  if (document.status !== "validating") {
    return { outcome: "skipped" };
  }

  const documentOwnership = ownership(document);
  const ingestionStartedAt = Date.now();
  const stageDurationsMs: Partial<Record<IngestionStage, number>> = {};
  let activeStage: IngestionStage = "download";
  let stageStartedAt = ingestionStartedAt;

  const finishStage = (nextStage?: IngestionStage): void => {
    const finishedAt = Date.now();
    stageDurationsMs[activeStage] = finishedAt - stageStartedAt;

    if (nextStage) {
      activeStage = nextStage;
      stageStartedAt = finishedAt;
    }
  };

  const timing = (): IngestionTiming => ({
    stageDurationsMs,
    totalDurationMs: Date.now() - ingestionStartedAt,
  });

  try {
    const parser = getDocumentParser(document.fileType);
    const content = await dependencies.loadDocument(document);
    finishStage("extract");
    const extracting = await dependencies.repository.transitionDocumentStatus(
      documentOwnership,
      "validating",
      "extracting",
    );

    if (!extracting) {
      return { outcome: "skipped" };
    }

    const blocks = await (dependencies.extract ?? parser.extract)(content);
    finishStage("chunk");
    await moveTo(
      dependencies.repository,
      documentOwnership,
      "extracting",
      "chunking",
    );

    const chunks = (dependencies.chunk ?? chunkDocumentBlocks)(blocks);
    finishStage("embed");
    await moveTo(
      dependencies.repository,
      documentOwnership,
      "chunking",
      "embedding",
    );

    const embedded = await (dependencies.embed ?? embedDocumentChunks)(chunks);
    finishStage("index");
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

    finishStage();
    logIngestion(ready, dependencies, "ready", timing());
    return { outcome: "ready", document: ready };
  } catch (error) {
    finishStage();
    const failure = processingFailure(error);
    const failed = await dependencies.repository.failDocumentProcessing({
      ...documentOwnership,
      error: failure,
    });

    if (failed) {
      logIngestion(failed, dependencies, "failed", timing(), failure.code);
    }

    return failed
      ? { outcome: "failed", document: failed }
      : { outcome: "skipped" };
  }
}
