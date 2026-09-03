import type { DocumentBlock, DocumentParser } from "@/types/documents";

import {
  isXmlRecord,
  openOfficeArchive,
  orderedChildren,
  orderedDescendants,
  orderedText,
  resolveArchiveTarget,
  xmlArray,
  xmlText,
  type OfficeArchive,
  type XmlRecord,
} from "./office-archive";
import { DocumentExtractionError } from "./parser-error";

export const MAX_XLSX_CELLS = 50_000;
const MAX_ROWS_PER_BLOCK = 40;
const MAX_CHARACTERS_PER_BLOCK = 12_000;
const BUILT_IN_DATE_FORMATS = new Set([
  14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 30, 36, 45, 46, 47, 50, 57,
]);

type WorkbookSheet = {
  name: string;
  path: string;
};

type SheetCell = {
  column: number;
  coordinate: string;
  value: string;
};

type SheetRow = {
  cells: SheetCell[];
  row: number;
};

function childRecord(record: XmlRecord, key: string): XmlRecord | undefined {
  const value = record[key];

  return isXmlRecord(value) ? value : undefined;
}

function stringAttribute(record: XmlRecord, key: string): string | undefined {
  const value = record[key];

  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : undefined;
}

function workbookSheets(archive: OfficeArchive): {
  date1904: boolean;
  sheets: WorkbookSheet[];
} {
  const workbook = archive.parseObject("xl/workbook.xml");
  const root = childRecord(workbook, "workbook");
  const sheetList = root && childRecord(root, "sheets");
  const workbookProperties = root && childRecord(root, "workbookPr");
  const relationships = archive.parseObject("xl/_rels/workbook.xml.rels");
  const relationshipRoot = childRecord(relationships, "Relationships");
  const targets = new Map<string, string>();

  for (const value of relationshipRoot
    ? xmlArray(relationshipRoot.Relationship)
    : []) {
    if (!isXmlRecord(value) || value.TargetMode === "External") {
      continue;
    }

    const id = stringAttribute(value, "Id");
    const target = stringAttribute(value, "Target");

    if (id && target) {
      targets.set(id, resolveArchiveTarget("xl/workbook.xml", target));
    }
  }

  const sheets = (sheetList ? xmlArray(sheetList.sheet) : []).map((value) => {
    if (!isXmlRecord(value)) {
      throw new DocumentExtractionError(
        "INVALID_OFFICE_FILE",
        "The XLSX workbook contains an invalid sheet entry.",
      );
    }

    const name = stringAttribute(value, "name")?.trim();
    const relationshipId = stringAttribute(value, "id");
    const target = relationshipId ? targets.get(relationshipId) : undefined;

    if (!name || !target || !archive.has(target)) {
      throw new DocumentExtractionError(
        "INVALID_OFFICE_FILE",
        "The XLSX sheet relationship map is invalid.",
      );
    }

    return { name: name.slice(0, 160), path: target };
  });

  if (sheets.length === 0) {
    throw new DocumentExtractionError(
      "INVALID_OFFICE_FILE",
      "The XLSX workbook contains no worksheets.",
    );
  }

  const date1904Value = workbookProperties
    ? stringAttribute(workbookProperties, "date1904")
    : undefined;

  return {
    date1904: date1904Value === "1" || date1904Value === "true",
    sheets,
  };
}

function sharedStrings(archive: OfficeArchive): string[] {
  if (!archive.has("xl/sharedStrings.xml")) {
    return [];
  }

  return orderedDescendants(
    archive.parseOrdered("xl/sharedStrings.xml"),
    "si",
  ).map((item) =>
    orderedText(orderedChildren(item, "si")).replace(/\s+/gu, " ").trim(),
  );
}

function customNumberFormats(archive: OfficeArchive): Map<number, string> {
  if (!archive.has("xl/styles.xml")) {
    return new Map();
  }

  const styles = archive.parseObject("xl/styles.xml");
  const root = childRecord(styles, "styleSheet");
  const numberFormats = root && childRecord(root, "numFmts");
  const formats = new Map<number, string>();

  for (const value of numberFormats ? xmlArray(numberFormats.numFmt) : []) {
    if (!isXmlRecord(value)) {
      continue;
    }

    const id = Number(stringAttribute(value, "numFmtId"));
    const code = stringAttribute(value, "formatCode");

    if (Number.isInteger(id) && code) {
      formats.set(id, code);
    }
  }

  return formats;
}

function cellStyleFormats(archive: OfficeArchive): number[] {
  if (!archive.has("xl/styles.xml")) {
    return [];
  }

  const styles = archive.parseObject("xl/styles.xml");
  const root = childRecord(styles, "styleSheet");
  const cellFormats = root && childRecord(root, "cellXfs");

  return (cellFormats ? xmlArray(cellFormats.xf) : []).map((value) =>
    isXmlRecord(value)
      ? Number(stringAttribute(value, "numFmtId") ?? 0)
      : 0,
  );
}

function isDateFormat(id: number, customFormats: ReadonlyMap<number, string>): boolean {
  if (BUILT_IN_DATE_FORMATS.has(id)) {
    return true;
  }

  const format = customFormats.get(id);

  if (!format) {
    return false;
  }

  const meaningful = format
    .replace(/"[^"]*"/gu, "")
    .replace(/\\./gu, "")
    .replace(/\[[^\]]*\]/gu, "");

  return /[ymdhis]/iu.test(meaningful);
}

function excelDate(serial: number, date1904: boolean): string {
  const epoch = date1904
    ? Date.UTC(1904, 0, 1)
    : Date.UTC(1899, 11, 30);
  const date = new Date(epoch + serial * 86_400_000);

  if (!Number.isFinite(date.getTime())) {
    return String(serial);
  }

  const iso = date.toISOString();

  return Math.abs(serial % 1) < 1e-10 ? iso.slice(0, 10) : iso.replace(".000Z", "Z");
}

function columnIndex(coordinate: string): number | null {
  const match = /^([A-Z]{1,3})[1-9]\d*$/iu.exec(coordinate);

  if (!match) {
    return null;
  }

  return [...match[1].toUpperCase()].reduce(
    (value, character) => value * 26 + character.charCodeAt(0) - 64,
    0,
  ) - 1;
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

function cellValue(
  cell: XmlRecord,
  strings: readonly string[],
  date1904: boolean,
  styleFormats: readonly number[],
  customFormats: ReadonlyMap<number, string>,
): string {
  const type = stringAttribute(cell, "t");
  const raw = xmlText(cell.v).trim();
  const formula = xmlText(cell.f).replace(/\s+/gu, " ").trim();
  let value = raw;

  if (type === "s") {
    const index = Number(raw);

    if (!Number.isInteger(index) || strings[index] === undefined) {
      throw new DocumentExtractionError(
        "INVALID_OFFICE_FILE",
        "The XLSX workbook contains an invalid shared string reference.",
      );
    }

    value = strings[index];
  } else if (type === "inlineStr") {
    const inlineString = childRecord(cell, "is");
    const directText = inlineString ? xmlText(inlineString.t) : "";
    const richText = inlineString
      ? xmlArray(inlineString.r)
          .filter(isXmlRecord)
          .map((run) => xmlText(run.t))
          .join("")
      : "";
    value = (directText || richText).replace(/\s+/gu, " ").trim();
  } else if (type === "b") {
    value = raw === "1" ? "TRUE" : "FALSE";
  } else if (raw) {
    const styleIndex = Number(stringAttribute(cell, "s"));
    const formatId = Number.isInteger(styleIndex)
      ? styleFormats[styleIndex]
      : undefined;
    const numeric = Number(raw);

    if (
      formatId !== undefined &&
      Number.isFinite(numeric) &&
      isDateFormat(formatId, customFormats)
    ) {
      value = excelDate(numeric, date1904);
    }
  }

  if (formula) {
    return value ? `${value} (formula: =${formula})` : `Formula: =${formula}`;
  }

  return value.replace(/\s+/gu, " ").trim();
}

function worksheetRows(
  archive: OfficeArchive,
  sheet: WorkbookSheet,
  strings: readonly string[],
  date1904: boolean,
  styleFormats: readonly number[],
  customFormats: ReadonlyMap<number, string>,
): SheetRow[] {
  const worksheet = archive.parseObject(sheet.path);
  const root = childRecord(worksheet, "worksheet");
  const sheetData = root && childRecord(root, "sheetData");
  const rows: SheetRow[] = [];

  for (const [rowIndex, value] of (sheetData ? xmlArray(sheetData.row) : []).entries()) {
    if (!isXmlRecord(value)) {
      continue;
    }

    const rowNumber = Number(stringAttribute(value, "r") ?? rowIndex + 1);
    const cells: SheetCell[] = [];

    for (const cellValueObject of xmlArray(value.c)) {
      if (!isXmlRecord(cellValueObject)) {
        continue;
      }

      const coordinate = stringAttribute(cellValueObject, "r")?.toUpperCase();
      const column = coordinate ? columnIndex(coordinate) : null;

      if (!coordinate || column === null) {
        throw new DocumentExtractionError(
          "INVALID_OFFICE_FILE",
          "The XLSX workbook contains an invalid cell coordinate.",
        );
      }

      const parsed = cellValue(
        cellValueObject,
        strings,
        date1904,
        styleFormats,
        customFormats,
      );

      if (parsed) {
        cells.push({ column, coordinate, value: parsed });
      }
    }

    if (cells.length > 0 && Number.isInteger(rowNumber) && rowNumber > 0) {
      rows.push({ cells, row: rowNumber });
    }
  }

  return rows;
}

function blockRange(rows: readonly SheetRow[]): string {
  const cells = rows.flatMap((row) => row.cells);
  const minColumn = Math.min(...cells.map((cell) => cell.column));
  const maxColumn = Math.max(...cells.map((cell) => cell.column));
  const minRow = Math.min(...rows.map((row) => row.row));
  const maxRow = Math.max(...rows.map((row) => row.row));

  return `${columnName(minColumn)}${minRow}:${columnName(maxColumn)}${maxRow}`;
}

function sheetBlocks(sheet: WorkbookSheet, rows: readonly SheetRow[]): DocumentBlock[] {
  if (rows.length === 0) {
    return [];
  }

  const header = rows[0];
  const headers = new Map(
    header.cells.map((cell) => [
      cell.column,
      cell.value || `Column ${columnName(cell.column)}`,
    ]),
  );
  const columns = header.cells
    .map((cell) => `${columnName(cell.column)}=${cell.value}`)
    .join(" | ");
  const dataRows = rows.slice(1);

  if (dataRows.length === 0) {
    const range = blockRange([header]);

    return [
      {
        text: `Sheet: ${sheet.name}\nColumns: ${columns}`,
        source: {
          label: `${sheet.name} - ${range}`,
          sheet: sheet.name,
          cellRange: range,
        },
      },
    ];
  }

  const blocks: DocumentBlock[] = [];
  let group: SheetRow[] = [];
  let characters = 0;

  const rowText = (row: SheetRow) =>
    `Row ${row.row}: ${row.cells
      .map(
        (cell) =>
          `${headers.get(cell.column) ?? `Column ${columnName(cell.column)}`}: ${cell.value}`,
      )
      .join(" | ")}`;

  const flush = () => {
    if (group.length === 0) {
      return;
    }

    const range = blockRange(group);

    blocks.push({
      text: [
        `Sheet: ${sheet.name}`,
        `Columns: ${columns}`,
        ...group.map(rowText),
      ].join("\n"),
      source: {
        label: `${sheet.name} - ${range}`,
        sheet: sheet.name,
        cellRange: range,
      },
    });
    group = [];
    characters = 0;
  };

  for (const row of dataRows) {
    const text = rowText(row);

    if (
      group.length > 0 &&
      (group.length >= MAX_ROWS_PER_BLOCK ||
        characters + text.length > MAX_CHARACTERS_PER_BLOCK)
    ) {
      flush();
    }

    group.push(row);
    characters += text.length;
  }

  flush();

  return blocks;
}

export const xlsxParser: DocumentParser = {
  supports(fileType) {
    return fileType === "xlsx";
  },

  async extract(content) {
    const archive = openOfficeArchive(content);
    const contentTypes = archive.requireText("[Content_Types].xml");

    if (!contentTypes.includes("spreadsheetml.sheet.main+xml")) {
      throw new DocumentExtractionError(
        "INVALID_OFFICE_FILE",
        "The archive is not a valid XLSX workbook.",
      );
    }

    const { date1904, sheets } = workbookSheets(archive);
    const strings = sharedStrings(archive);
    const customFormats = customNumberFormats(archive);
    const styleFormats = cellStyleFormats(archive);
    let cellCount = 0;
    const blocks: DocumentBlock[] = [];

    for (const sheet of sheets) {
      const rows = worksheetRows(
        archive,
        sheet,
        strings,
        date1904,
        styleFormats,
        customFormats,
      );
      cellCount += rows.reduce((total, row) => total + row.cells.length, 0);

      if (cellCount > MAX_XLSX_CELLS) {
        throw new DocumentExtractionError(
          "XLSX_TOO_MANY_CELLS",
          `XLSX files are limited to ${MAX_XLSX_CELLS.toLocaleString("en-US")} non-empty cells.`,
        );
      }

      blocks.push(...sheetBlocks(sheet, rows));
    }

    if (blocks.length === 0) {
      throw new DocumentExtractionError(
        "NO_EXTRACTABLE_TEXT",
        "The XLSX file contains no readable cells.",
      );
    }

    return blocks;
  },
};
