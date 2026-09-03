import type { DocumentBlock, DocumentSource } from "@/types/documents";

export type ChunkingOptions = {
  maxCharacters?: number;
  maxWords: number;
  overlapWords: number;
};

export type DocumentChunk = {
  text: string;
  source: DocumentSource;
  chunkIndex: number;
};

export const DEFAULT_CHUNKING_OPTIONS: ChunkingOptions = {
  // Keeps even dense or delimiter-free content below the embedding limit.
  maxCharacters: 6_000,
  // About 600 tokens for ordinary French or English prose.
  maxWords: 450,
  // About 100 tokens, without requiring a model-specific tokenizer.
  overlapWords: 75,
};

function validateOptions(options: ChunkingOptions): void {
  if (
    options.maxCharacters !== undefined &&
    (!Number.isInteger(options.maxCharacters) || options.maxCharacters <= 0)
  ) {
    throw new Error("maxCharacters must be a positive integer");
  }

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
  const maxCharacters =
    options.maxCharacters ?? DEFAULT_CHUNKING_OPTIONS.maxCharacters ?? 6_000;

  for (const block of blocks) {
    const words = block.text
      .trim()
      .split(/\s+/u)
      .filter(Boolean)
      .flatMap((word) => {
        if (word.length <= maxCharacters) {
          return word;
        }

        const segments: string[] = [];

        for (let start = 0; start < word.length; start += maxCharacters) {
          segments.push(word.slice(start, start + maxCharacters));
        }

        return segments;
      });

    if (words.length === 0) {
      continue;
    }

    let start = 0;

    while (start < words.length) {
      let end = start;
      let characters = 0;

      while (end < words.length && end - start < options.maxWords) {
        const addedCharacters = words[end].length + (end > start ? 1 : 0);

        if (end > start && characters + addedCharacters > maxCharacters) {
          break;
        }

        characters += addedCharacters;
        end += 1;
      }

      chunks.push({
        text: words.slice(start, end).join(" "),
        source: { ...block.source },
        chunkIndex: chunks.length,
      });

      if (end === words.length) {
        break;
      }

      start = Math.max(start + 1, end - options.overlapWords);
    }
  }

  return chunks;
}
