import type {
  DocumentParser,
  SupportedFileType,
} from "@/types/documents";

import { csvParser } from "./csv-parser";
import { docxParser } from "./docx-parser";
import { DocumentExtractionError } from "./parser-error";
import { pdfParser } from "./pdf-parser";
import { markdownParser, txtParser } from "./plain-text-parser";
import { pptxParser } from "./pptx-parser";
import { xlsxParser } from "./xlsx-parser";

const parsers = {
  pdf: pdfParser,
  docx: docxParser,
  pptx: pptxParser,
  xlsx: xlsxParser,
  txt: txtParser,
  md: markdownParser,
  csv: csvParser,
} as const satisfies Record<SupportedFileType, DocumentParser>;

export function getDocumentParser(
  fileType: SupportedFileType,
): DocumentParser {
  const parser = parsers[fileType];

  if (!parser || !parser.supports(fileType)) {
    throw new DocumentExtractionError(
      "UNSUPPORTED_FILE_TYPE",
      `The ${String(fileType).toUpperCase()} file type is not supported.`,
    );
  }

  return parser;
}
