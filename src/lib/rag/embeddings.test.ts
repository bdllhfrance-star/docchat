// @vitest-environment node

import { describe, expect, test, vi } from "vitest";

import type { DocumentChunk } from "./chunking";
import {
  embedDocumentChunks,
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
      maxParallelCalls: 2,
    });
  });

  test("embeds every chunk while preserving text and sources", async () => {
    const embedTexts = vi.fn(async () => [vector(0.1), vector(0.2)]);

    const embedded = await embedDocumentChunks(chunks, { embedTexts });

    expect(embedTexts).toHaveBeenCalledWith(
      ["First passage", "Second passage"],
      expect.any(AbortSignal),
    );
    expect(embedded).toEqual([
      { ...chunks[0], embedding: vector(0.1) },
      { ...chunks[1], embedding: vector(0.2) },
    ]);
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
