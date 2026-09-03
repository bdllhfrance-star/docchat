// @vitest-environment node

import { describe, expect, test, vi } from "vitest";

import type { DocumentChunk } from "./chunking";
import {
  embedDocumentChunks,
  embedRetrievalQuery,
  GEMINI_EMBEDDING_CONFIG,
} from "./embeddings";

const chunks: DocumentChunk[] = [
  {
    text: "First passage",
    source: { label: "Page 1", page: 1 },
    chunkIndex: 0,
  },
  {
    text: "Second passage",
    source: { label: "Page 2", page: 2 },
    chunkIndex: 1,
  },
];

function vector(value: number): number[] {
  return Array.from(
    { length: GEMINI_EMBEDDING_CONFIG.dimensions },
    () => value,
  );
}

describe("document embeddings", () => {
  test("uses the stable Gemini model configuration", () => {
    expect(GEMINI_EMBEDDING_CONFIG).toMatchObject({
      modelId: "gemini-embedding-2",
      dimensions: 768,
      inputTokenLimit: 8_192,
      taskType: "RETRIEVAL_DOCUMENT",
      queryTaskType: "RETRIEVAL_QUERY",
      maxParallelCalls: 2,
    });
  });

  test("embeds every chunk while preserving text and sources", async () => {
    const embedTexts = vi.fn(async () => [vector(0.1), vector(0.2)]);

    const embedded = await embedDocumentChunks(chunks, { embedTexts });

    expect(embedTexts).toHaveBeenCalledWith(
      [
        "Page: 1\n\nFirst passage",
        "Page: 2\n\nSecond passage",
      ],
      expect.any(AbortSignal),
    );
    expect(embedded).toEqual([
      { ...chunks[0], embedding: vector(0.1) },
      { ...chunks[1], embedding: vector(0.2) },
    ]);
  });

  test("adds structural location to embeddings without changing stored text", async () => {
    const spreadsheetChunk: DocumentChunk = {
      text: "Amount: 42 EUR",
      source: {
        label: "Sales - B2:B2",
        section: "Invoices",
        sheet: "Sales",
        cellRange: "B2:B2",
      },
      chunkIndex: 0,
    };
    const embedTexts = vi.fn(async () => [vector(0.4)]);

    const [embedded] = await embedDocumentChunks([spreadsheetChunk], {
      embedTexts,
    });

    expect(embedTexts).toHaveBeenCalledWith(
      [
        "Section: Invoices\nSheet: Sales\nCells: B2:B2\n\nAmount: 42 EUR",
      ],
      expect.any(AbortSignal),
    );
    expect(embedded.text).toBe("Amount: 42 EUR");
    expect(embedded.source).toEqual(spreadsheetChunk.source);
  });

  test("rejects missing or malformed vectors", async () => {
    await expect(
      embedDocumentChunks(chunks, {
        embedTexts: async () => [vector(0.1)],
      }),
    ).rejects.toMatchObject({ code: "EMBEDDING_COUNT_MISMATCH" });

    await expect(
      embedDocumentChunks(chunks.slice(0, 1), {
        embedTexts: async () => [[1, 2, 3]],
      }),
    ).rejects.toMatchObject({ code: "EMBEDDING_DIMENSION_MISMATCH" });
  });

  test("returns a stable error when Gemini fails", async () => {
    await expect(
      embedDocumentChunks(chunks, {
        embedTexts: async () => {
          throw new Error("provider detail");
        },
      }),
    ).rejects.toMatchObject({
      code: "EMBEDDING_REQUEST_FAILED",
      message: "Gemini could not generate the document embeddings.",
    });
  });

  test("handles timeout without waiting for the provider", async () => {
    await expect(
      embedDocumentChunks(chunks, {
        timeoutMilliseconds: 1,
        embedTexts: async (_texts, signal) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener("abort", () => reject(signal.reason), {
              once: true,
            });
          }),
      }),
    ).rejects.toMatchObject({ code: "EMBEDDING_TIMEOUT" });
  });

  test("does not call Gemini for an empty chunk list", async () => {
    const embedTexts = vi.fn();

    await expect(embedDocumentChunks([], { embedTexts })).resolves.toEqual([]);
    expect(embedTexts).not.toHaveBeenCalled();
  });
});

describe("retrieval query embeddings", () => {
  test("embeds one query with the shared vector dimension", async () => {
    const embedQuery = vi.fn(async () => vector(0.3));

    await expect(
      embedRetrievalQuery("What does the contract require?", { embedQuery }),
    ).resolves.toEqual(vector(0.3));
    expect(embedQuery).toHaveBeenCalledWith(
      "What does the contract require?",
      expect.any(AbortSignal),
    );
  });

  test("rejects empty queries and malformed query vectors", async () => {
    const embedQuery = vi.fn(async () => [1, 2, 3]);

    await expect(
      embedRetrievalQuery("   ", { embedQuery }),
    ).rejects.toMatchObject({ code: "EMBEDDING_REQUEST_FAILED" });
    expect(embedQuery).not.toHaveBeenCalled();
    await expect(
      embedRetrievalQuery("question", { embedQuery }),
    ).rejects.toMatchObject({ code: "EMBEDDING_DIMENSION_MISMATCH" });
  });
});
