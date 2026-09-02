import type { AggregateOptions, Document } from "mongodb";

import { getDatabase } from "@/lib/db/client";
import {
  chunkTextSearchIndex,
  databaseCollectionNames,
} from "@/lib/db/indexes";
import {
  retrieveRelevantChunks,
  type RetrievedChunk,
  type VectorRetrievalInput,
  type VectorRetrievalOptions,
  validateRetrievalInput,
  VectorRetrievalError,
  VECTOR_SEARCH_CONFIG,
} from "@/lib/rag/vector-search";
import {
  supportedFileTypes,
  type ChunkRecord,
  type DocumentSource,
  type SupportedFileType,
} from "@/types/documents";

export const HYBRID_SEARCH_CONFIG = {
  rrfRankConstant: 60,
  timeoutMilliseconds: VECTOR_SEARCH_CONFIG.timeoutMilliseconds,
} as const;

type StoredTextSearchResult = {
  id: string;
  sessionId: string;
  batchId: string;
  documentId: string;
  filename: string;
  fileType: SupportedFileType;
  text: string;
  source: DocumentSource;
  chunkIndex: number;
  score: number;
};

type AggregateTextSearch = (
  pipeline: Document[],
  options: AggregateOptions & { signal?: AbortSignal },
) => Promise<StoredTextSearchResult[]>;

export type HybridRetrievalOptions = {
  abortSignal?: AbortSignal;
  aggregateText?: AggregateTextSearch;
  timeoutMilliseconds?: number;
  vector?: Omit<VectorRetrievalOptions, "abortSignal" | "timeoutMilliseconds">;
};

export function createTextSearchPipeline(
  input: VectorRetrievalInput,
): Document[] {
  const documentIds = validateRetrievalInput(input);

  return [
    {
      $search: {
        index: chunkTextSearchIndex.name,
        compound: {
          must: [
            {
              text: {
                query: input.query.trim(),
                path: "text",
              },
            },
          ],
          filter: [
            { equals: { path: "sessionId", value: input.sessionId } },
            { equals: { path: "batchId", value: input.batchId } },
            { in: { path: "documentId", value: documentIds } },
          ],
        },
      },
    },
    { $limit: input.limit },
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
        score: { $meta: "searchScore" },
      },
    },
  ];
}

async function aggregateTextWithMongo(
  pipeline: Document[],
  options: AggregateOptions & { signal?: AbortSignal },
): Promise<StoredTextSearchResult[]> {
  const database = await getDatabase();

  return database
    .collection<ChunkRecord>(databaseCollectionNames.chunks)
    .aggregate<StoredTextSearchResult>(pipeline, options)
    .toArray();
}

function sanitizeTextResults(
  results: readonly StoredTextSearchResult[],
  input: VectorRetrievalInput,
  allowedDocumentIds: ReadonlySet<string>,
): RetrievedChunk[] {
  const seenIds = new Set<string>();
  const sanitized: RetrievedChunk[] = [];

  for (const result of results) {
    if (
      result.sessionId !== input.sessionId ||
      result.batchId !== input.batchId ||
      !allowedDocumentIds.has(result.documentId) ||
      !result.id ||
      !result.filename ||
      !supportedFileTypes.includes(result.fileType) ||
      !result.text ||
      !result.source ||
      typeof result.source.label !== "string" ||
      !Number.isInteger(result.chunkIndex) ||
      !Number.isFinite(result.score) ||
      result.score < 0
    ) {
      throw new VectorRetrievalError(
        "RETRIEVAL_INVALID_RESULT",
        "Text Search returned an invalid or unauthorized chunk.",
      );
    }

    if (seenIds.has(result.id)) {
      continue;
    }

    seenIds.add(result.id);
    sanitized.push({
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

  return sanitized.slice(0, input.limit);
}

export function fuseRankedChunks(
  rankings: readonly (readonly RetrievedChunk[])[],
  limit: number,
): RetrievedChunk[] {
  const fused = new Map<
    string,
    { chunk: RetrievedChunk; firstSeen: number; score: number }
  >();
  let firstSeen = 0;

  for (const ranking of rankings) {
    ranking.forEach((chunk, index) => {
      const existing = fused.get(chunk.id);
      const score =
        1 / (HYBRID_SEARCH_CONFIG.rrfRankConstant + index + 1);

      if (existing) {
        existing.score += score;
      } else {
        fused.set(chunk.id, { chunk, firstSeen: firstSeen++, score });
      }
    });
  }

  return [...fused.values()]
    .sort(
      (left, right) =>
        right.score - left.score || left.firstSeen - right.firstSeen,
    )
    .slice(0, limit)
    .map(({ chunk, score }) => ({ ...chunk, score, scoreKind: "rrf" }));
}

async function retrieveTextChunks(
  input: VectorRetrievalInput,
  options: HybridRetrievalOptions,
): Promise<RetrievedChunk[]> {
  const documentIds = validateRetrievalInput(input);
  const timeoutMilliseconds =
    options.timeoutMilliseconds ?? HYBRID_SEARCH_CONFIG.timeoutMilliseconds;
  const timeoutSignal = AbortSignal.timeout(timeoutMilliseconds);
  const signal = options.abortSignal
    ? AbortSignal.any([options.abortSignal, timeoutSignal])
    : timeoutSignal;

  try {
    const results = await (options.aggregateText ?? aggregateTextWithMongo)(
      createTextSearchPipeline(input),
      { maxTimeMS: timeoutMilliseconds, signal },
    );

    return sanitizeTextResults(results, input, new Set(documentIds));
  } catch (error) {
    if (error instanceof VectorRetrievalError) {
      throw error;
    }

    if (options.abortSignal?.aborted) {
      throw new VectorRetrievalError(
        "RETRIEVAL_ABORTED",
        "Hybrid retrieval was cancelled.",
      );
    }

    if (timeoutSignal.aborted) {
      throw new VectorRetrievalError(
        "RETRIEVAL_TIMEOUT",
        "Text retrieval timed out.",
      );
    }

    throw new VectorRetrievalError(
      "RETRIEVAL_SEARCH_FAILED",
      "MongoDB Atlas Text Search failed.",
    );
  }
}

export async function retrieveHybridChunks(
  input: VectorRetrievalInput,
  options: HybridRetrievalOptions = {},
): Promise<RetrievedChunk[]> {
  validateRetrievalInput(input);

  const [vectorResults, textResults] = await Promise.all([
    retrieveRelevantChunks(input, {
      ...options.vector,
      abortSignal: options.abortSignal,
      timeoutMilliseconds: options.timeoutMilliseconds,
    }),
    retrieveTextChunks(input, options),
  ]);

  return fuseRankedChunks([vectorResults, textResults], input.limit);
}
