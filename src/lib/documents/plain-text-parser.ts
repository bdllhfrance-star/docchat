import type { DocumentBlock, DocumentParser } from "@/types/documents";

import { DocumentExtractionError } from "./parser-error";
import { decodeDocumentText } from "./text-decoding";

const MAX_LINES_PER_BLOCK = 80;
const MAX_CHARACTERS_PER_BLOCK = 8_000;

function lineLabel(start: number, end: number): string {
  return start === end ? `Line ${start}` : `Lines ${start}-${end}`;
}

function lineBlocks(text: string): DocumentBlock[] {
  const lines = text.split("\n");
  const blocks: DocumentBlock[] = [];
  let cursor = 0;

  while (cursor < lines.length) {
    while (cursor < lines.length && !lines[cursor].trim()) {
      cursor += 1;
    }

    if (cursor >= lines.length) {
      break;
    }

    const start = cursor;
    let characters = 0;

    while (cursor < lines.length && cursor - start < MAX_LINES_PER_BLOCK) {
      const nextLength = lines[cursor].length + 1;

      if (cursor > start && characters + nextLength > MAX_CHARACTERS_PER_BLOCK) {
        break;
      }

      characters += nextLength;
      cursor += 1;
    }

    const end = cursor;
    const blockText = lines.slice(start, end).join("\n").trim();

    if (blockText) {
      blocks.push({
        text: blockText,
        source: {
          label: lineLabel(start + 1, end),
          lineStart: start + 1,
          lineEnd: end,
        },
      });
    }
  }

  return blocks;
}

function assertBlocks(blocks: DocumentBlock[]): DocumentBlock[] {
  if (blocks.length === 0) {
    throw new DocumentExtractionError(
      "NO_EXTRACTABLE_TEXT",
      "The document contains no readable text.",
    );
  }

  return blocks;
}

function markdownSections(text: string): DocumentBlock[] {
  const lines = text.split("\n");
  const blocks: DocumentBlock[] = [];
  const headings: string[] = [];
  let sectionStart = 0;
  let currentSection: string | undefined;

  const flush = (endExclusive: number) => {
    const sectionText = lines.slice(sectionStart, endExclusive).join("\n").trim();

    if (!sectionText) {
      return;
    }

    const startLine = sectionStart + 1;
    const endLine = endExclusive;
    const location = lineLabel(startLine, endLine);

    blocks.push({
      text: sectionText,
      source: {
        label: currentSection ? `${currentSection} · ${location}` : location,
        ...(currentSection ? { section: currentSection } : {}),
        lineStart: startLine,
        lineEnd: endLine,
      },
    });
  };

  lines.forEach((line, index) => {
    const match = /^(#{1,6})[ \t]+(.+?)\s*#*\s*$/u.exec(line);

    if (!match) {
      return;
    }

    flush(index);
    const level = match[1].length;
    const title = match[2].trim().slice(0, 160);
    headings.length = level - 1;
    headings[level - 1] = title;
    currentSection = headings.filter(Boolean).join(" › ").slice(0, 400);
    sectionStart = index;
  });

  flush(lines.length);

  return blocks;
}

export const txtParser: DocumentParser = {
  supports(fileType) {
    return fileType === "txt";
  },

  async extract(content) {
    return assertBlocks(lineBlocks(decodeDocumentText(content)));
  },
};

export const markdownParser: DocumentParser = {
  supports(fileType) {
    return fileType === "md";
  },

  async extract(content) {
    return assertBlocks(markdownSections(decodeDocumentText(content)));
  },
};
