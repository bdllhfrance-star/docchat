import type { DocumentBlock, DocumentSource } from "@/types/documents";

export type ChunkingOptions = {
  maxWords: number;
  overlapWords: number;
};

export type DocumentChunk = {
  text: string;
  source: DocumentSource;
  chunkIndex: number;
};

export const DEFAULT_CHUNKING_OPTIONS: ChunkingOptions = {
  // About 600 tokens for ordinary French or English prose.
  maxWords: 450,
  // About 100 tokens, without requiring a model-specific tokenizer.
  overlapWords: 75,
};

function validateOptions(options: ChunkingOptions): void {
  if (!Number.isInteger(options.maxWords) || options.maxWords <= 0) {
    throw new Error("maxWords must be a positive integer");
  }

  if (
    !Number.isInteger(options.overlapWords) ||
    options.overlapWords < 0 ||
    options.overlapWords >= options.maxWords
  ) {
    throw new Error("overlapWords must be between 0 and maxWords - 1");
  }
}

export function chunkDocumentBlocks(
  blocks: readonly DocumentBlock[],
  options: ChunkingOptions = DEFAULT_CHUNKING_OPTIONS,
): DocumentChunk[] {
  validateOptions(options);

  const chunks: DocumentChunk[] = [];

  for (const block of blocks) {
    const words = block.text.trim().split(/\s+/u).filter(Boolean);

    if (words.length === 0) {
      continue;
    }

    let start = 0;

    while (start < words.length) {
      const end = Math.min(start + options.maxWords, words.length);

      chunks.push({
        text: words.slice(start, end).join(" "),
        source: { ...block.source },
        chunkIndex: chunks.length,
      });

      if (end === words.length) {
        break;
      }

      start = end - options.overlapWords;
    }
  }

  return chunks;
}
