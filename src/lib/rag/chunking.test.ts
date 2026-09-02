import { describe, expect, test } from "vitest";

import type { DocumentBlock } from "@/types/documents";

import { chunkDocumentBlocks } from "./chunking";

function words(prefix: string, count: number): string {
  return Array.from({ length: count }, (_, index) => `${prefix}${index + 1}`).join(
    " ",
  );
}

describe("document chunking", () => {
  test("applies the configured size and overlap", () => {
    const chunks = chunkDocumentBlocks(
      [{ text: words("w", 10), source: { label: "Page 1", page: 1 } }],
      { maxWords: 4, overlapWords: 1 },
    );

    expect(chunks.map((chunk) => chunk.text)).toEqual([
      "w1 w2 w3 w4",
      "w4 w5 w6 w7",
      "w7 w8 w9 w10",
    ]);
    expect(chunks.map((chunk) => chunk.chunkIndex)).toEqual([0, 1, 2]);
  });

  test("never mixes pages and keeps their source", () => {
    const blocks: DocumentBlock[] = [
      { text: "first page", source: { label: "Page 1", page: 1 } },
      { text: "second page", source: { label: "Page 2", page: 2 } },
    ];

    const chunks = chunkDocumentBlocks(blocks, {
      maxWords: 10,
      overlapWords: 2,
    });

    expect(chunks).toEqual([
      {
        text: "first page",
        source: { label: "Page 1", page: 1 },
        chunkIndex: 0,
      },
      {
        text: "second page",
        source: { label: "Page 2", page: 2 },
        chunkIndex: 1,
      },
    ]);
  });

  test("ignores empty blocks", () => {
    expect(
      chunkDocumentBlocks([
        { text: "  \n ", source: { label: "Page 1", page: 1 } },
      ]),
    ).toEqual([]);
  });

  test("rejects invalid options", () => {
    const blocks = [
      { text: "some text", source: { label: "Page 1", page: 1 } },
    ];

    expect(() =>
      chunkDocumentBlocks(blocks, { maxWords: 0, overlapWords: 0 }),
    ).toThrow("maxWords");
    expect(() =>
      chunkDocumentBlocks(blocks, { maxWords: 4, overlapWords: 4 }),
    ).toThrow("overlapWords");
  });
});
