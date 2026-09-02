import { google } from "@ai-sdk/google";
import { embedMany } from "ai";

import type { DocumentChunk } from "@/lib/rag/chunking";

export const GEMINI_EMBEDDING_CONFIG = {
  modelId: "gemini-embedding-2",
  dimensions: 768,
  inputTokenLimit: 8_192,
  taskType: "RETRIEVAL_DOCUMENT",
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

export type EmbedDocumentChunkOptions = {
  abortSignal?: AbortSignal;
  embedTexts?: EmbedTexts;
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
      chunks.map((chunk) => chunk.text),
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
