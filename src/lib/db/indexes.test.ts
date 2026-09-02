import { describe, expect, test } from "vitest";

import {
  batchIndexes,
  chunkIndexes,
  chunkTextSearchIndex,
  chunkVectorSearchIndex,
  documentIndexes,
} from "@/lib/db/indexes";

describe("database index definitions", () => {
  test.each([
    ["batches", batchIndexes],
    ["documents", documentIndexes],
    ["chunks", chunkIndexes],
  ])("defines a zero-second TTL index for %s", (_collection, indexes) => {
    expect(indexes).toContainEqual(
      expect.objectContaining({
        key: { expiresAt: 1 },
        expireAfterSeconds: 0,
      }),
    );
  });

  test("defines the Atlas vector contract without creating it", () => {
    expect(chunkVectorSearchIndex).toMatchObject({
      type: "vectorSearch",
      definition: {
        fields: expect.arrayContaining([
          expect.objectContaining({
            type: "vector",
            path: "embedding",
            numDimensions: 768,
            similarity: "cosine",
          }),
          { type: "filter", path: "sessionId" },
          { type: "filter", path: "batchId" },
          { type: "filter", path: "documentId" },
        ]),
      },
    });
  });

  test("keeps the lexical Atlas Search definition separate", () => {
    expect(chunkTextSearchIndex).toMatchObject({
      type: "search",
      definition: {
        mappings: {
          dynamic: false,
          fields: { text: { type: "string" } },
        },
      },
    });
  });
});
