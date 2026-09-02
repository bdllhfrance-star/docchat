import type { AggregateOptions, Document } from "mongodb";

import { getDatabase } from "@/lib/db/client";
import {
  chunkVectorSearchIndex,
  databaseCollectionNames,
} from "@/lib/db/indexes";
import {
  embedRetrievalQuery,
  GEMINI_EMBEDDING_CONFIG,
} from "@/lib/rag/embeddings";
import { MAX_FILES_PER_BATCH } from "@/lib/uploads/validation";
import type {
  ChunkRecord,
  DocumentSource,
  SupportedFileType,
} from "@/types/documents";

export const VECTOR_SEARCH_CONFIG = {
  candidateMultiplier: 20,
  maxCandidates: 10_000,
  maxResults: 500,
  timeoutMilliseconds: 10_000,
} as const;

export type VectorRetrievalErrorCode =
  | "RETRIEVAL_ABORTED"
  | "RETRIEVAL_INVALID_INPUT"
  | "RETRIEVAL_INVALID_RESULT"
  | "RETRIEVAL_SEARCH_FAILED"
  | "RETRIEVAL_TIMEOUT";

export class VectorRetrievalError extends Error {
  constructor(
    readonly code: VectorRetrievalErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "VectorRetrievalError";
  }
}

export type RetrievedChunk = {
  id: string;
  documentId: string;
  filename: string;
  fileType: SupportedFileType;
  text: string;
  source: DocumentSource;
  chunkIndex: number;
  score: number;
  scoreKind?: "similarity" | "rrf";
};

type StoredVectorSearchResult = RetrievedChunk & {
  sessionId: string;
  batchId: string;
};

export type VectorRetrievalInput = {
  sessionId: string;
  batchId: string;
  documentIds: readonly string[];
  query: string;
  limit: number;
};

type AggregateVectorSearch = (
  pipeline: Document[],
  options: AggregateOptions & { signal?: AbortSignal },
) => Promise<StoredVectorSearchResult[]>;

export type VectorRetrievalOptions = {
  abortSignal?: AbortSignal;
  aggregate?: AggregateVectorSearch;
  embedQuery?: (
    query: string,
    options: { abortSignal?: AbortSignal },
  ) => Promise<number[]>;
  timeoutMilliseconds?: number;
};

function invalidInput(message: string): never {
  throw new VectorRetrievalError("RETRIEVAL_INVALID_INPUT", message);
}

export function validateRetrievalInput(input: VectorRetrievalInput): string[] {
  if (!input.sessionId || !input.batchId) {
    invalidInput("Session and batch identifiers are required.");
  }

  if (!input.query.trim()) {
    invalidInput("The retrieval query cannot be empty.");
  }

  const documentIds = [...new Set(input.documentIds)];

  if (documentIds.length === 0 || documentIds.some((id) => !id)) {
    invalidInput("At least one document identifier is required.");
  }

  if (documentIds.length > MAX_FILES_PER_BATCH) {
    invalidInput(
      `No more than ${MAX_FILES_PER_BATCH} document identifiers are allowed.`,
    );
  }

  if (
    !Number.isInteger(input.limit) ||
    input.limit < 1 ||
    input.limit > VECTOR_SEARCH_CONFIG.maxResults
  ) {
    invalidInput(
      `The vector result limit must be between 1 and ${VECTOR_SEARCH_CONFIG.maxResults}.`,
    );
  }

  return documentIds;
}

function validateQueryVector(embedding: readonly number[]): void {
  if (
    embedding.length !== GEMINI_EMBEDDING_CONFIG.dimensions ||
    embedding.some((value) => !Number.isFinite(value))
  ) {
    invalidInput(
      `The query embedding must contain ${GEMINI_EMBEDDING_CONFIG.dimensions} finite values.`,
    );
  }
}

export function createVectorSearchPipeline(
  input: Omit<VectorRetrievalInput, "query">,
  queryVector: readonly number[],
): Document[] {
  const documentIds = validateRetrievalInput({
    ...input,
    query: "validated-query",
  });
  validateQueryVector(queryVector);
  const numCandidates = Math.min(
    VECTOR_SEARCH_CONFIG.maxCandidates,
    input.limit * VECTOR_SEARCH_CONFIG.candidateMultiplier,
  );

  return [
    {
      $vectorSearch: {
        index: chunkVectorSearchIndex.name,
        path: "embedding",
        queryVector: [...queryVector],
        numCandidates,
        limit: input.limit,
        filter: {
          $and: [
            { sessionId: { $eq: input.sessionId } },
            { batchId: { $eq: input.batchId } },
            { documentId: { $in: documentIds } },
          ],
        },
      },
    },
    {
      $project: {
        _id: 0,
        id: 1,
        sessionId: 1,
        batchId: 1,
        documentId: 1,
        filename: 1,
        fileType: 1,
        text: 1,
        source: 1,
        chunkIndex: 1,
        score: { $meta: "vectorSearchScore" },
      },
    },
  ];
}

async function aggregateWithMongo(
  pipeline: Document[],
  options: AggregateOptions & { signal?: AbortSignal },
): Promise<StoredVectorSearchResult[]> {
  const database = await getDatabase();

  return database
    .collection<ChunkRecord>(databaseCollectionNames.chunks)
    .aggregate<StoredVectorSearchResult>(pipeline, options)
    .toArray();
}

function sanitizeResults(
  results: readonly StoredVectorSearchResult[],
  input: VectorRetrievalInput,
  allowedDocumentIds: ReadonlySet<string>,
): RetrievedChunk[] {
  const seenChunkIds = new Set<string>();
  const retrieved: RetrievedChunk[] = [];

  for (const result of results) {
    if (
      result.sessionId !== input.sessionId ||
      result.batchId !== input.batchId ||
      !allowedDocumentIds.has(result.documentId) ||
      !result.id ||
      !result.filename ||
      !result.text ||
      !Number.isInteger(result.chunkIndex) ||
      !Number.isFinite(result.score) ||
      result.score < 0 ||
      result.score > 1
    ) {
      throw new VectorRetrievalError(
        "RETRIEVAL_INVALID_RESULT",
        "Vector Search returned an invalid or unauthorized chunk.",
      );
    }

    if (seenChunkIds.has(result.id)) {
      continue;
    }

    seenChunkIds.add(result.id);
    retrieved.push({
      id: result.id,
      documentId: result.documentId,
      filename: result.filename,
      fileType: result.fileType,
      text: result.text,
      source: result.source,
      chunkIndex: result.chunkIndex,
      score: result.score,
    });
  }

  return retrieved.slice(0, input.limit);
}

export async function retrieveRelevantChunks(
  input: VectorRetrievalInput,
  options: VectorRetrievalOptions = {},
): Promise<RetrievedChunk[]> {
  const documentIds = validateRetrievalInput(input);
  const queryVector = await (options.embedQuery ?? embedRetrievalQuery)(
    input.query.trim(),
    { abortSignal: options.abortSignal },
  );
  validateQueryVector(queryVector);

  const timeoutSignal = AbortSignal.timeout(
    options.timeoutMilliseconds ?? VECTOR_SEARCH_CONFIG.timeoutMilliseconds,
  );
  const signal = options.abortSignal
    ? AbortSignal.any([options.abortSignal, timeoutSignal])
    : timeoutSignal;
  const pipeline = createVectorSearchPipeline(
    {
      sessionId: input.sessionId,
      batchId: input.batchId,
      documentIds,
      limit: input.limit,
    },
    queryVector,
  );

  try {
    const results = await (options.aggregate ?? aggregateWithMongo)(pipeline, {
      maxTimeMS:
        options.timeoutMilliseconds ?? VECTOR_SEARCH_CONFIG.timeoutMilliseconds,
      signal,
    });

    return sanitizeResults(results, input, new Set(documentIds));
  } catch (error) {
    if (error instanceof VectorRetrievalError) {
      throw error;
    }

    if (options.abortSignal?.aborted) {
      throw new VectorRetrievalError(
        "RETRIEVAL_ABORTED",
        "Vector retrieval was cancelled.",
      );
    }

    if (timeoutSignal.aborted) {
      throw new VectorRetrievalError(
        "RETRIEVAL_TIMEOUT",
        "Vector retrieval timed out.",
      );
    }

    throw new VectorRetrievalError(
      "RETRIEVAL_SEARCH_FAILED",
      "MongoDB Atlas Vector Search failed.",
    );
  }
}
