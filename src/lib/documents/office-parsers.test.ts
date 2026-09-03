// @vitest-environment node

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

const docxFixture = () =>
  archive({
    "[Content_Types].xml": `<?xml version="1.0"?>
      <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
        <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
      </Types>`,
    "word/styles.xml": `<?xml version="1.0"?>
      <w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:style w:type="paragraph" w:styleId="Heading1">
          <w:name w:val="Heading 1"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr>
        </w:style>
      </w:styles>`,
    "word/document.xml": `<?xml version="1.0"?>
      <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:body>
          <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Contract</w:t></w:r></w:p>
          <w:p><w:r><w:t>Reference ZX-104 is payable in 30 days.</w:t></w:r></w:p>
          <w:sdt><w:sdtContent><w:p><w:r><w:t>Controlled clause: renewal is automatic.</w:t></w:r></w:p></w:sdtContent></w:sdt>
          <w:tbl>
            <w:tr><w:tc><w:p><w:r><w:t>Item</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Price</w:t></w:r></w:p></w:tc></w:tr>
            <w:tr><w:tc><w:p><w:r><w:t>Service</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>120 EUR</w:t></w:r></w:p></w:tc></w:tr>
          </w:tbl>
        </w:body>
      </w:document>`,
  });

const pptxFixture = () =>
  archive({
    "[Content_Types].xml": `<?xml version="1.0"?>
      <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
        <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
      </Types>`,
    "ppt/presentation.xml": `<?xml version="1.0"?>
      <p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
        <p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst>
      </p:presentation>`,
    "ppt/_rels/presentation.xml.rels": `<?xml version="1.0"?>
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rId1" Type="slide" Target="slides/slide1.xml"/>
      </Relationships>`,
    "ppt/slides/slide1.xml": `<?xml version="1.0"?>
      <p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:cSld><p:spTree>
          <p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>Quarterly Review</a:t></a:r></a:p></p:txBody></p:sp>
          <p:sp><p:txBody><a:p><a:r><a:t>Revenue increased by 18 percent.</a:t></a:r></a:p></p:txBody></p:sp>
          <p:graphicFrame><a:graphic><a:graphicData><a:tbl>
            <a:tr><a:tc><a:txBody><a:p><a:r><a:t>Metric</a:t></a:r></a:p></a:txBody></a:tc><a:tc><a:txBody><a:p><a:r><a:t>Value</a:t></a:r></a:p></a:txBody></a:tc></a:tr>
            <a:tr><a:tc><a:txBody><a:p><a:r><a:t>Growth</a:t></a:r></a:p></a:txBody></a:tc><a:tc><a:txBody><a:p><a:r><a:t>18%</a:t></a:r></a:p></a:txBody></a:tc></a:tr>
          </a:tbl></a:graphicData></a:graphic></p:graphicFrame>
        </p:spTree></p:cSld>
      </p:sld>`,
  });

const xlsxFixture = () =>
  archive({
    "[Content_Types].xml": `<?xml version="1.0"?>
      <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
        <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
      </Types>`,
    "xl/workbook.xml": `<?xml version="1.0"?>
      <workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
        <sheets><sheet name="Sales" sheetId="1" r:id="rId1"/></sheets>
      </workbook>`,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0"?>
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/>
      </Relationships>`,
    "xl/sharedStrings.xml": `<?xml version="1.0"?>
      <sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="4" uniqueCount="4">
        <si><t>Product</t></si><si><t>Amount</t></si><si><t>Date</t></si><si><t>Widget</t></si>
      </sst>`,
    "xl/styles.xml": `<?xml version="1.0"?>
      <styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
        <numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/></numFmts>
        <cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="164"/></cellXfs>
      </styleSheet>`,
    "xl/worksheets/sheet1.xml": `<?xml version="1.0"?>
      <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>
        <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row>
        <row r="2"><c r="A2" t="s"><v>3</v></c><c r="B2"><v>42</v></c><c r="C2" s="1"><v>45292</v></c></row>
        <row r="3"><c r="A3" t="inlineStr"><is><t>Total</t></is></c><c r="B3"><f>SUM(B2:B2)</f><v>42</v></c></row>
      </sheetData></worksheet>`,
  });

describe("Office document parsers", () => {
  test("extracts DOCX headings, paragraphs, and tables by section", async () => {
    const blocks = await docxParser.extract(docxFixture());

    expect(blocks).toEqual([
      expect.objectContaining({
        source: { label: "Section Contract", section: "Contract" },
        text: expect.stringContaining("Reference ZX-104 is payable in 30 days."),
      }),
    ]);
    expect(blocks[0].text).toContain("Item | Price");
    expect(blocks[0].text).toContain("Service | 120 EUR");
    expect(blocks[0].text).toContain(
      "Controlled clause: renewal is automatic.",
    );
  });

  test("extracts PPTX title, body, and table with the visual slide number", async () => {
    const blocks = await pptxParser.extract(pptxFixture());

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      source: {
        label: "Slide 1 - Quarterly Review",
        slide: 1,
        section: "Quarterly Review",
      },
    });
    expect(blocks[0].text).toContain("Revenue increased by 18 percent.");
    expect(blocks[0].text).toContain("Growth | 18%");
  });

  test("extracts XLSX rows with headers, formulas, dates, sheet, and range", async () => {
    const blocks = await xlsxParser.extract(xlsxFixture());

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      source: {
        label: "Sales - A2:C3",
        sheet: "Sales",
        cellRange: "A2:C3",
      },
    });
    expect(blocks[0].text).toContain(
      "Row 2: Product: Widget | Amount: 42 | Date: 2024-01-01",
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
