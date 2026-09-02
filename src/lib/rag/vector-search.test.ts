// @vitest-environment node

import { describe, expect, test, vi } from "vitest";

import { GEMINI_EMBEDDING_CONFIG } from "@/lib/rag/embeddings";

import {
  createVectorSearchPipeline,
  retrieveRelevantChunks,
  VECTOR_SEARCH_CONFIG,
} from "./vector-search";

const sessionId = "271bf840-1fed-443d-86fb-a82b0bd70465";
const batchId = "9f92701f-4866-45e6-b21f-1be3decc8d7d";
const documentIds = [
  "e267df76-9b0e-4616-b187-0252faf57880",
  "75f9d4bc-c530-43dd-a30f-91dad3ab8ff4",
];

function vector(value = 0.1): number[] {
  return Array.from(
    { length: GEMINI_EMBEDDING_CONFIG.dimensions },
    () => value,
  );
}

function storedResult(overrides: Record<string, unknown> = {}) {
  return {
    id: "80140e63-f8cb-4095-9cbd-dae9da4cf930",
    sessionId,
    batchId,
    documentId: documentIds[0],
    filename: "guide.pdf",
    fileType: "pdf" as const,
    text: "The relevant contract passage.",
    source: { label: "Page 4", page: 4 },
    chunkIndex: 3,
    score: 0.91,
    ...overrides,
  };
}

describe("Atlas vector retrieval", () => {
  test("builds a cosine search pipeline with all ownership filters", () => {
    const pipeline = createVectorSearchPipeline(
      { sessionId, batchId, documentIds, limit: 40 },
      vector(),
    );

    expect(pipeline[0]).toEqual({
      $vectorSearch: {
        index: "chunk_vector_search",
        path: "embedding",
        queryVector: vector(),
        numCandidates: 800,
        limit: 40,
        filter: {
          $and: [
            { sessionId: { $eq: sessionId } },
            { batchId: { $eq: batchId } },
            { documentId: { $in: documentIds } },
          ],
        },
      },
    });
    expect(pipeline[1]).toMatchObject({
      $project: { score: { $meta: "vectorSearchScore" } },
    });
  });

  test("embeds the question, deduplicates chunks, and returns sources with scores", async () => {
    const embedQuery = vi.fn().mockResolvedValue(vector());
    const result = storedResult();
    const aggregate = vi.fn().mockResolvedValue([result, result]);

    await expect(
      retrieveRelevantChunks(
        {
          sessionId,
          batchId,
          documentIds: [documentIds[0], documentIds[0]],
          query: "  contract requirement  ",
          limit: 25,
        },
        { embedQuery, aggregate },
      ),
    ).resolves.toEqual([
      {
        id: result.id,
        documentId: result.documentId,
        filename: result.filename,
        fileType: result.fileType,
        text: result.text,
        source: result.source,
        chunkIndex: result.chunkIndex,
        score: result.score,
      },
    ]);
    expect(embedQuery).toHaveBeenCalledWith("contract requirement", {
      abortSignal: undefined,
    });
    expect(aggregate).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        maxTimeMS: VECTOR_SEARCH_CONFIG.timeoutMilliseconds,
        signal: expect.any(AbortSignal),
      }),
    );
    const pipeline = aggregate.mock.calls[0][0];
    expect(pipeline[0].$vectorSearch.filter).toEqual({
      $and: [
        { sessionId: { $eq: sessionId } },
        { batchId: { $eq: batchId } },
        { documentId: { $in: [documentIds[0]] } },
      ],
    });
  });

  test("refuses an unauthorized chunk even if the provider returns one", async () => {
    await expect(
      retrieveRelevantChunks(
        {
          sessionId,
          batchId,
          documentIds,
          query: "contract",
          limit: 10,
        },
        {
          embedQuery: async () => vector(),
          aggregate: async () => [storedResult({ sessionId: "other-session" })],
        },
      ),
    ).rejects.toMatchObject({ code: "RETRIEVAL_INVALID_RESULT" });
  });

  test("validates limits and vectors before querying Atlas", async () => {
    const aggregate = vi.fn();

    await expect(
      retrieveRelevantChunks(
        {
          sessionId,
          batchId,
          documentIds: [],
          query: "contract",
          limit: 10,
        },
        { embedQuery: async () => vector(), aggregate },
      ),
    ).rejects.toMatchObject({ code: "RETRIEVAL_INVALID_INPUT" });
    await expect(
      retrieveRelevantChunks(
        {
          sessionId,
          batchId,
          documentIds,
          query: "contract",
          limit: VECTOR_SEARCH_CONFIG.maxResults + 1,
        },
        { embedQuery: async () => vector(), aggregate },
      ),
    ).rejects.toMatchObject({ code: "RETRIEVAL_INVALID_INPUT" });
    await expect(
      retrieveRelevantChunks(
        {
          sessionId,
          batchId,
          documentIds,
          query: "contract",
          limit: 10,
        },
        { embedQuery: async () => [1, 2, 3], aggregate },
      ),
    ).rejects.toMatchObject({ code: "RETRIEVAL_INVALID_INPUT" });
    expect(aggregate).not.toHaveBeenCalled();
  });

  test("returns stable provider and timeout errors", async () => {
    const input = {
      sessionId,
      batchId,
      documentIds,
      query: "contract",
      limit: 10,
    };

    await expect(
      retrieveRelevantChunks(input, {
        embedQuery: async () => vector(),
        aggregate: async () => {
          throw new Error("provider details");
        },
      }),
    ).rejects.toMatchObject({ code: "RETRIEVAL_SEARCH_FAILED" });

    await expect(
      retrieveRelevantChunks(input, {
        timeoutMilliseconds: 1,
        embedQuery: async () => vector(),
        aggregate: async (_pipeline, options) =>
          new Promise((_resolve, reject) => {
            options.signal?.addEventListener(
              "abort",
              () => reject(options.signal?.reason),
              { once: true },
            );
          }),
      }),
    ).rejects.toMatchObject({ code: "RETRIEVAL_TIMEOUT" });
  });
});
