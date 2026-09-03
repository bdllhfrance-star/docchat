// @vitest-environment node

import { readFile } from "node:fs/promises";
import path from "node:path";

import { strToU8, zipSync } from "fflate";
import { describe, expect, test } from "vitest";

import { docxParser } from "./docx-parser";
import { openOfficeArchive } from "./office-archive";
import { pptxParser } from "./pptx-parser";
import { xlsxParser } from "./xlsx-parser";

function archive(entries: Record<string, string | Uint8Array>): ArrayBuffer {
  const zipped = zipSync(
    Object.fromEntries(
      Object.entries(entries).map(([pathname, value]) => [
        pathname,
        typeof value === "string" ? strToU8(value) : value,
      ]),
    ),
  );

  return zipped.buffer.slice(
    zipped.byteOffset,
    zipped.byteOffset + zipped.byteLength,
  ) as ArrayBuffer;
}

async function fixture(filename: string): Promise<ArrayBuffer> {
  const file = await readFile(
    path.join(process.cwd(), "tests", "fixtures", "documents", filename),
  );

  return file.buffer.slice(
    file.byteOffset,
    file.byteOffset + file.byteLength,
  ) as ArrayBuffer;
}

describe("Office document parsers", () => {
  test("extracts DOCX headings, paragraphs, and tables by section", async () => {
    const blocks = await docxParser.extract(await fixture("contract-smoke.docx"));

    expect(blocks).toEqual([
      expect.objectContaining({
        source: {
          label: "Section Contract Terms",
          section: "Contract Terms",
        },
        text: expect.stringContaining("Contract reference DOCX-104."),
      }),
    ]);
    expect(blocks[0].text).toContain("Item | Price");
    expect(blocks[0].text).toContain("Support | 120 EUR");
    expect(blocks[0].text).toContain("Renewal owner: Amina.");
  });

  test("extracts PPTX title, body, and table with the visual slide number", async () => {
    const blocks = await pptxParser.extract(
      await fixture("quarterly-smoke.pptx"),
    );

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      source: {
        label: "Slide 1 - Quarterly Review",
        slide: 1,
        section: "Quarterly Review",
      },
    });
    expect(blocks[0].text).toContain("Revenue increased by 18 percent.");
    expect(blocks[0].text).toContain("Presentation code PPTX-882.");
  });

  test("extracts XLSX rows with headers, formulas, dates, sheet, and range", async () => {
    const blocks = await xlsxParser.extract(await fixture("sales-smoke.xlsx"));

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      source: {
        label: "Sales - A2:C3",
        sheet: "Sales",
        cellRange: "A2:C3",
      },
    });
    expect(blocks[0].text).toContain(
        "Row 2: Product: Widget | Amount: 42 | Record: XLSX-553",
    );
    expect(blocks[0].text).toContain("42 (formula: =SUM(B2:B2))");
  });

  test("rejects malformed, encrypted-container, and macro-enabled Office files", () => {
    expect(() => openOfficeArchive(new TextEncoder().encode("not a zip").buffer))
      .toThrowError(expect.objectContaining({ code: "INVALID_OFFICE_FILE" }));
    expect(() =>
      openOfficeArchive(
        Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).buffer,
      ),
    ).toThrowError(expect.objectContaining({ code: "OFFICE_FILE_ENCRYPTED" }));
    expect(() =>
      openOfficeArchive(
        archive({
          "[Content_Types].xml": "<Types/>",
          "word/vbaProject.bin": Uint8Array.from([1, 2, 3]),
        }),
      ),
    ).toThrowError(expect.objectContaining({ code: "INVALID_OFFICE_FILE" }));
  });

  test("refuses oversized expanded XML before parsing it", () => {
    const oversizedXml = new Uint8Array(10 * 1024 * 1024 + 1);

    expect(() =>
      openOfficeArchive(
        archive({
          "[Content_Types].xml": "<Types/>",
          "word/document.xml": oversizedXml,
        }),
      ),
    ).toThrowError(
      expect.objectContaining({ code: "OFFICE_ARCHIVE_LIMIT_EXCEEDED" }),
    );
  });
});
