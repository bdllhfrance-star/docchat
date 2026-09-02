// @vitest-environment node

import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, test } from "vitest";

import { pdfParser, PdfExtractionError } from "./pdf-parser";

const fixtureDirectory = path.join(
  process.cwd(),
  "tests",
  "fixtures",
  "documents",
);

async function fixture(name: string): Promise<ArrayBuffer> {
  const file = await readFile(path.join(fixtureDirectory, name));

  return file.buffer.slice(
    file.byteOffset,
    file.byteOffset + file.byteLength,
  ) as ArrayBuffer;
}

function blankPdf(): ArrayBuffer {
  const source = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << >> /Contents 4 0 R >>
endobj
4 0 obj
<< /Length 0 >>
stream

endstream
endobj
trailer
<< /Root 1 0 R /Size 5 >>
%%EOF`;

  return new TextEncoder().encode(source).buffer;
}

async function expectErrorCode(
  promise: Promise<unknown>,
  code: PdfExtractionError["code"],
) {
  await expect(promise).rejects.toMatchObject({
    name: "PdfExtractionError",
    code,
  });
}

describe("PDF parser", () => {
  test("supports only PDF files", () => {
    expect(pdfParser.supports("pdf")).toBe(true);
    expect(pdfParser.supports("docx")).toBe(false);
  });

  test("extracts the French fixture page by page", async () => {
    const blocks = await pdfParser.extract(
      await fixture("wikipedia-contribution-guide-fr.pdf"),
    );

    expect(blocks).toHaveLength(13);
    expect(blocks[0]).toMatchObject({
      source: { label: "Page 1", page: 1 },
    });
    expect(blocks.map((block) => block.text).join(" ")).toContain(
      "Comment puis-je contribuer",
    );
  });

  test("keeps Arabic native text and page locations", async () => {
    const blocks = await pdfParser.extract(
      await fixture("wikipedia-classroom-booklet-ar.pdf"),
    );

    expect(blocks).toHaveLength(10);
    expect(blocks[9].source).toEqual({ label: "Page 10", page: 10 });
    expect(blocks.some((block) => /[\u0600-\u06ff\ufb50-\ufdff\ufe70-\ufeff]/u.test(block.text))).toBe(
      true,
    );
  });

  test("returns explicit errors for empty, invalid, and textless PDFs", async () => {
    await expectErrorCode(pdfParser.extract(new ArrayBuffer(0)), "EMPTY_PDF");
    await expectErrorCode(
      pdfParser.extract(await fixture("truncated.pdf")),
      "INVALID_PDF",
    );
    await expectErrorCode(
      pdfParser.extract(new TextEncoder().encode("not a PDF").buffer),
      "INVALID_PDF",
    );
    await expectErrorCode(
      pdfParser.extract(blankPdf()),
      "NO_EXTRACTABLE_TEXT",
    );
  });
});
