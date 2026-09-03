import type { DocumentBlock, DocumentParser } from "@/types/documents";

import { DocumentExtractionError } from "./parser-error";
import { decodeDocumentText } from "./text-decoding";

const MAX_ROWS_PER_BLOCK = 40;
const MAX_CHARACTERS_PER_BLOCK = 12_000;

type CsvRow = {
  values: string[];
  lineStart: number;
  lineEnd: number;
};

function delimiterScore(line: string, delimiter: string): number {
  let count = 0;
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    if (line[index] === '"') {
      if (quoted && line[index + 1] === '"') {
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (!quoted && line[index] === delimiter) {
      count += 1;
    }
  }

  return count;
}

function detectDelimiter(text: string): string {
  const sample = text.split("\n").find((line) => line.trim()) ?? "";
  const candidates = [",", ";", "\t"];

  return candidates.reduce((best, candidate) =>
    delimiterScore(sample, candidate) > delimiterScore(sample, best)
      ? candidate
      : best,
  );
}

function parseRows(text: string, delimiter: string): CsvRow[] {
  const rows: CsvRow[] = [];
  let values: string[] = [];
  let field = "";
  let quoted = false;
  let afterQuote = false;
  let line = 1;
  let rowStart = 1;

  const finishRow = () => {
    values.push(field);
    rows.push({ values, lineStart: rowStart, lineEnd: line });
    values = [];
    field = "";
    afterQuote = false;
    rowStart = line + 1;
  };

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];

    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (quoted) {
        quoted = false;
        afterQuote = true;
      } else if (!field.trim()) {
        field = "";
        quoted = true;
      } else {
        field += character;
      }
    } else if (afterQuote) {
      if (character === delimiter) {
        values.push(field);
        field = "";
        afterQuote = false;
      } else if (character === "\n") {
        finishRow();
        line += 1;
      } else if (!/\s/u.test(character)) {
        throw new DocumentExtractionError(
          "INVALID_CSV",
          "The CSV file contains characters after a closing quote.",
        );
      }
    } else if (character === delimiter && !quoted) {
      values.push(field);
      field = "";
    } else if (character === "\n") {
      if (quoted) {
        field += "\n";
        line += 1;
      } else {
        finishRow();
        line += 1;
      }
    } else {
      field += character;
    }
  }

  if (quoted) {
    throw new DocumentExtractionError(
      "INVALID_CSV",
      "The CSV file contains an unclosed quoted field.",
    );
  }

  if (field || values.length > 0) {
    values.push(field);
    rows.push({ values, lineStart: rowStart, lineEnd: line });
  }

  return rows.filter((row) => row.values.some((value) => value.trim()));
}

function columnName(index: number): string {
  let value = index + 1;
  let label = "";

  while (value > 0) {
    value -= 1;
    label = String.fromCharCode(65 + (value % 26)) + label;
    value = Math.floor(value / 26);
  }

  return label;
}

function normalizedValue(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function csvBlocks(rows: CsvRow[]): DocumentBlock[] {
  if (rows.length === 0) {
    throw new DocumentExtractionError(
      "NO_EXTRACTABLE_TEXT",
      "The CSV file contains no readable rows.",
    );
  }

  const headerRow = rows[0];
  const headers = headerRow.values.map(
    (value, index) => normalizedValue(value) || `Column ${columnName(index)}`,
  );
  const dataRows = rows.slice(1);

  if (dataRows.length === 0) {
    return [
      {
        text: `Columns: ${headers.join(" | ")}`,
        source: {
          label: `Line ${headerRow.lineStart}`,
          lineStart: headerRow.lineStart,
          lineEnd: headerRow.lineEnd,
        },
      },
    ];
  }

  const blocks: DocumentBlock[] = [];
  let group: CsvRow[] = [];
  let groupCharacters = 0;

  const rowText = (row: CsvRow) => {
    const pairs = row.values
      .map((value, index) => {
        const normalized = normalizedValue(value);

        return normalized
          ? `${headers[index] ?? `Column ${columnName(index)}`}: ${normalized}`
          : "";
      })
      .filter(Boolean);

    return `Row ${row.lineStart}: ${pairs.join(" | ")}`;
  };

  const flush = () => {
    if (group.length === 0) {
      return;
    }

    const start = group[0].lineStart;
    const end = group.at(-1)?.lineEnd ?? start;

    blocks.push({
      text: [`Columns: ${headers.join(" | ")}`, ...group.map(rowText)].join("\n"),
      source: {
        label: start === end ? `Line ${start}` : `Lines ${start}-${end}`,
        lineStart: start,
        lineEnd: end,
      },
    });
    group = [];
    groupCharacters = 0;
  };

  for (const row of dataRows) {
    const text = rowText(row);

    if (
      group.length > 0 &&
      (group.length >= MAX_ROWS_PER_BLOCK ||
        groupCharacters + text.length > MAX_CHARACTERS_PER_BLOCK)
    ) {
      flush();
    }

    group.push(row);
    groupCharacters += text.length;
  }

  flush();

  return blocks;
}

export const csvParser: DocumentParser = {
  supports(fileType) {
    return fileType === "csv";
  },

  async extract(content) {
    const text = decodeDocumentText(content);
    const rows = parseRows(text, detectDelimiter(text));

    return csvBlocks(rows);
  },
};
