import { CanvasFactory } from "pdf-parse/worker";
import {
  FormatError,
  InvalidPDFException,
  PasswordException,
  PDFParse,
} from "pdf-parse";

import type {
  DocumentBlock,
  DocumentParser,
} from "@/types/documents";

export const MAX_PDF_PAGES = 50;

export type PdfExtractionErrorCode =
  | "EMPTY_PDF"
  | "ENCRYPTED_PDF"
  | "INVALID_PDF"
  | "NO_EXTRACTABLE_TEXT"
  | "PDF_EXTRACTION_FAILED"
  | "PDF_TOO_MANY_PAGES";

export class PdfExtractionError extends Error {
  constructor(
    readonly code: PdfExtractionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PdfExtractionError";
  }
}

function normalizePageText(text: string): string {
  return text
    .replaceAll("\u0000", "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeExtractionError(error: unknown): PdfExtractionError {
  if (error instanceof PdfExtractionError) {
    return error;
  }

  if (error instanceof PasswordException) {
    return new PdfExtractionError(
      "ENCRYPTED_PDF",
      "Password-protected PDF files are not supported.",
    );
  }

  if (error instanceof InvalidPDFException || error instanceof FormatError) {
    return new PdfExtractionError(
      "INVALID_PDF",
      "The PDF file is invalid or damaged.",
    );
  }

  return new PdfExtractionError(
    "PDF_EXTRACTION_FAILED",
    "The PDF text could not be extracted.",
  );
}

export const pdfParser: DocumentParser = {
  supports(fileType) {
    return fileType === "pdf";
  },

  async extract(content: ArrayBuffer): Promise<DocumentBlock[]> {
    if (content.byteLength === 0) {
      throw new PdfExtractionError("EMPTY_PDF", "The PDF file is empty.");
    }

    const signature = new TextDecoder("ascii").decode(
      new Uint8Array(content, 0, Math.min(5, content.byteLength)),
    );

    if (signature !== "%PDF-") {
      throw new PdfExtractionError(
        "INVALID_PDF",
        "The PDF file signature is invalid.",
      );
    }

    const parser = new PDFParse({
      data: content,
      stopAtErrors: true,
      CanvasFactory,
    });

    try {
      const info = await parser.getInfo();

      if (info.total > MAX_PDF_PAGES) {
        throw new PdfExtractionError(
          "PDF_TOO_MANY_PAGES",
          `PDF files are limited to ${MAX_PDF_PAGES} pages.`,
        );
      }

      const result = await parser.getText({ pageJoiner: "" });
      const blocks = result.pages.flatMap((page) => {
        const text = normalizePageText(page.text);

        return text
          ? [
              {
                text,
                source: {
                  label: `Page ${page.num}`,
                  page: page.num,
                },
              },
            ]
          : [];
      });

      if (blocks.length === 0) {
        throw new PdfExtractionError(
          "NO_EXTRACTABLE_TEXT",
          "The PDF contains no extractable text. Scanned files require OCR.",
        );
      }

      return blocks;
    } catch (error) {
      throw normalizeExtractionError(error);
    } finally {
      await parser.destroy();
    }
  },
};
