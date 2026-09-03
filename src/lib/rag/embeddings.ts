import { google } from "@ai-sdk/google";
import { embed, embedMany } from "ai";

import type { DocumentChunk } from "@/lib/rag/chunking";

export const GEMINI_EMBEDDING_CONFIG = {
  modelId: "gemini-embedding-2",
  dimensions: 768,
  inputTokenLimit: 8_192,
  taskType: "RETRIEVAL_DOCUMENT",
  queryTaskType: "RETRIEVAL_QUERY",
  maxParallelCalls: 2,
  timeoutMilliseconds: 60_000,
} as const;

export type EmbeddedDocumentChunk = DocumentChunk & {
  embedding: number[];
};

export type EmbeddingErrorCode =
  | "EMBEDDING_ABORTED"
  | "EMBEDDING_COUNT_MISMATCH"
  | "EMBEDDING_DIMENSION_MISMATCH"
  | "EMBEDDING_REQUEST_FAILED"
  | "EMBEDDING_TIMEOUT";

export class EmbeddingError extends Error {
  constructor(
    readonly code: EmbeddingErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "EmbeddingError";
  }
}

type EmbedTexts = (
  texts: string[],
  signal: AbortSignal,
) => Promise<number[][]>;

type EmbedQuery = (query: string, signal: AbortSignal) => Promise<number[]>;

function embeddingText(chunk: DocumentChunk): string {
  const context = [
    chunk.source.section ? `Section: ${chunk.source.section}` : "",
    chunk.source.slide ? `Slide: ${chunk.source.slide}` : "",
    chunk.source.sheet ? `Sheet: ${chunk.source.sheet}` : "",
    chunk.source.cellRange ? `Cells: ${chunk.source.cellRange}` : "",
    chunk.source.page ? `Page: ${chunk.source.page}` : "",
    chunk.source.lineStart
      ? `Lines: ${chunk.source.lineStart}-${chunk.source.lineEnd ?? chunk.source.lineStart}`
      : "",
  ].filter(Boolean);

  return context.length > 0
    ? `${context.join("\n")}\n\n${chunk.text}`
    : chunk.text;
}

export type EmbedDocumentChunkOptions = {
  abortSignal?: AbortSignal;
  embedTexts?: EmbedTexts;
  timeoutMilliseconds?: number;
};

export type EmbedRetrievalQueryOptions = {
  abortSignal?: AbortSignal;
  embedQuery?: EmbedQuery;
  timeoutMilliseconds?: number;
};

async function embedTextsWithGemini(
  texts: string[],
  signal: AbortSignal,
): Promise<number[][]> {
  const result = await embedMany({
    model: google.embedding(GEMINI_EMBEDDING_CONFIG.modelId),
    values: texts,
    maxParallelCalls: GEMINI_EMBEDDING_CONFIG.maxParallelCalls,
    maxRetries: 2,
    abortSignal: signal,
    providerOptions: {
      google: {
        outputDimensionality: GEMINI_EMBEDDING_CONFIG.dimensions,
        taskType: GEMINI_EMBEDDING_CONFIG.taskType,
      },
    },
  });

  return result.embeddings;
}

async function embedQueryWithGemini(
  query: string,
  signal: AbortSignal,
): Promise<number[]> {
  const result = await embed({
    model: google.embedding(GEMINI_EMBEDDING_CONFIG.modelId),
    value: query,
    maxRetries: 2,
    abortSignal: signal,
    providerOptions: {
      google: {
        outputDimensionality: GEMINI_EMBEDDING_CONFIG.dimensions,
        taskType: GEMINI_EMBEDDING_CONFIG.queryTaskType,
      },
    },
  });

  return result.embedding;
}

function validateEmbeddings(
  embeddings: readonly (readonly number[])[],
  expectedCount: number,
): void {
  if (embeddings.length !== expectedCount) {
    throw new EmbeddingError(
      "EMBEDDING_COUNT_MISMATCH",
      "Gemini returned an unexpected number of embeddings.",
    );
  }

  if (
    embeddings.some(
      (embedding) =>
        embedding.length !== GEMINI_EMBEDDING_CONFIG.dimensions ||
        embedding.some((value) => !Number.isFinite(value)),
    )
  ) {
    throw new EmbeddingError(
      "EMBEDDING_DIMENSION_MISMATCH",
      `Gemini embeddings must contain ${GEMINI_EMBEDDING_CONFIG.dimensions} finite values.`,
    );
  }
}

export async function embedDocumentChunks(
  chunks: readonly DocumentChunk[],
  options: EmbedDocumentChunkOptions = {},
): Promise<EmbeddedDocumentChunk[]> {
  if (chunks.length === 0) {
    return [];
  }

  const timeoutSignal = AbortSignal.timeout(
    options.timeoutMilliseconds ??
      GEMINI_EMBEDDING_CONFIG.timeoutMilliseconds,
  );
  const signal = options.abortSignal
    ? AbortSignal.any([options.abortSignal, timeoutSignal])
    : timeoutSignal;

  try {
    const embeddings = await (options.embedTexts ?? embedTextsWithGemini)(
      chunks.map(embeddingText),
      signal,
    );
    validateEmbeddings(embeddings, chunks.length);

    return chunks.map((chunk, index) => ({
      ...chunk,
      embedding: [...embeddings[index]],
    }));
  } catch (error) {
    if (error instanceof EmbeddingError) {
      throw error;
    }

    if (options.abortSignal?.aborted) {
      throw new EmbeddingError(
        "EMBEDDING_ABORTED",
        "Embedding generation was cancelled.",
      );
    }

    if (timeoutSignal.aborted) {
      throw new EmbeddingError(
        "EMBEDDING_TIMEOUT",
        "Embedding generation timed out.",
      );
    }

    throw new EmbeddingError(
      "EMBEDDING_REQUEST_FAILED",
      "Gemini could not generate the document embeddings.",
    );
  }
}

export async function embedRetrievalQuery(
  query: string,
  options: EmbedRetrievalQueryOptions = {},
): Promise<number[]> {
  if (!query.trim()) {
    throw new EmbeddingError(
      "EMBEDDING_REQUEST_FAILED",
      "The retrieval query cannot be empty.",
    );
  }

  const timeoutSignal = AbortSignal.timeout(
    options.timeoutMilliseconds ??
      GEMINI_EMBEDDING_CONFIG.timeoutMilliseconds,
  );
  const signal = options.abortSignal
    ? AbortSignal.any([options.abortSignal, timeoutSignal])
    : timeoutSignal;

  try {
    const embedding = await (options.embedQuery ?? embedQueryWithGemini)(
      query,
      signal,
    );
    validateEmbeddings([embedding], 1);

    return [...embedding];
  } catch (error) {
    if (error instanceof EmbeddingError) {
      throw error;
    }

    if (options.abortSignal?.aborted) {
      throw new EmbeddingError(
        "EMBEDDING_ABORTED",
        "Embedding generation was cancelled.",
      );
    }

    if (timeoutSignal.aborted) {
      throw new EmbeddingError(
        "EMBEDDING_TIMEOUT",
        "Embedding generation timed out.",
      );
    }

    throw new EmbeddingError(
      "EMBEDDING_REQUEST_FAILED",
      "Gemini could not generate the query embedding.",
    );
  }
}
