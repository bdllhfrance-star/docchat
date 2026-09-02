// @vitest-environment node

import { describe, expect, test, vi } from "vitest";

import { GEMINI_EMBEDDING_CONFIG } from "@/lib/rag/embeddings";
import type { RetrievedChunk } from "@/lib/rag/vector-search";

import {
  createTextSearchPipeline,
  fuseRankedChunks,
  retrieveHybridChunks,
} from "./hybrid-search";

const sessionId = "271bf840-1fed-443d-86fb-a82b0bd70465";
const batchId = "9f92701f-4866-45e6-b21f-1be3decc8d7d";
const documentIds = [
  "e267df76-9b0e-4616-b187-0252faf57880",
  "75f9d4bc-c530-43dd-a30f-91dad3ab8ff4",
];

function chunk(id: string, documentId = documentIds[0]): RetrievedChunk {
  return {
    id,
    documentId,
    filename: `${documentId}.pdf`,
    fileType: "pdf",
    text: `Content for ${id}`,
    source: { label: "Page 1", page: 1 },
    chunkIndex: 0,
    score: 0.9,
  };
}

function storedTextResult(overrides: Record<string, unknown> = {}) {
  return {
    ...chunk("chunk-text", documentIds[1]),
    sessionId,
    batchId,
    score: 4.2,
    ...overrides,
  };
}

const input = {
  sessionId,
  batchId,
  documentIds,
  query: "contract requirement",
  limit: 10,
};

describe("hybrid retrieval", () => {
  test("builds text search with exact ownership and document filters", () => {
    const pipeline = createTextSearchPipeline(input);

    expect(pipeline[0]).toEqual({
      $search: {
        index: "chunk_text_search",
        compound: {
          must: [
            { text: { query: input.query, path: "text" } },
          ],
          filter: [
            { equals: { path: "sessionId", value: sessionId } },
            { equals: { path: "batchId", value: batchId } },
            { in: { path: "documentId", value: documentIds } },
          ],
        },
      },
    });
    expect(pipeline[1]).toEqual({ $limit: 10 });
    expect(pipeline[2]).toMatchObject({
      $project: { score: { $meta: "searchScore" } },
    });
  });

  test("fuses vector and lexical ranks with deterministic RRF", () => {
    const first = chunk("first");
    const shared = chunk("shared");
    const third = chunk("third", documentIds[1]);
    const result = fuseRankedChunks(
      [
        [first, shared],
        [shared, third],
      ],
      3,
    );

    expect(result.map((item) => item.id)).toEqual(["shared", "first", "third"]);
    expect(result.every((item) => item.scoreKind === "rrf")).toBe(true);
    expect(result[0].score).toBeCloseTo(1 / 62 + 1 / 61);
  });

  test("runs vector and text search and keeps both document filters", async () => {
    const aggregateVector = vi.fn().mockResolvedValue([
      { ...storedTextResult(), id: "chunk-vector", score: 0.91 },
    ]);
    const aggregateText = vi.fn().mockResolvedValue([storedTextResult()]);

    const results = await retrieveHybridChunks(input, {
      aggregateText,
      vector: {
        embedQuery: async () =>
          Array.from(
            { length: GEMINI_EMBEDDING_CONFIG.dimensions },
            () => 0.1,
          ),
        aggregate: aggregateVector,
      },
    });

    expect(results.map((item) => item.id)).toEqual([
      "chunk-vector",
      "chunk-text",
    ]);
    expect(aggregateVector).toHaveBeenCalledOnce();
    expect(aggregateText).toHaveBeenCalledOnce();
  });

  test("refuses a lexical result from another session", async () => {
    await expect(
      retrieveHybridChunks(input, {
        aggregateText: async () => [
          storedTextResult({ sessionId: "other-session" }),
        ],
        vector: {
          embedQuery: async () =>
            Array.from(
              { length: GEMINI_EMBEDDING_CONFIG.dimensions },
              () => 0.1,
            ),
          aggregate: async () => [],
        },
      }),
    ).rejects.toMatchObject({ code: "RETRIEVAL_INVALID_RESULT" });
  });
});
