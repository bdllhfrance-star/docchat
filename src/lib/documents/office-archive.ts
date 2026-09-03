import { XMLParser } from "fast-xml-parser";
import { unzipSync } from "fflate";

import { DocumentExtractionError } from "./parser-error";

const MAX_ARCHIVE_ENTRIES = 2_500;
const MAX_UNCOMPRESSED_BYTES = 100 * 1024 * 1024;
const MAX_XML_BYTES = 25 * 1024 * 1024;
const MAX_SINGLE_XML_BYTES = 10 * 1024 * 1024;
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_DIRECTORY_ENTRY = 0x02014b50;
const OLE_COMPOUND_SIGNATURE = [
  0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1,
] as const;

export type XmlRecord = Record<string, unknown>;
export type OrderedXmlNode = Record<string, unknown>;

function readUint32(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] |
    (bytes[offset + 1] << 8) |
    (bytes[offset + 2] << 16) |
    (bytes[offset + 3] << 24)
  ) >>> 0;
}

function readUint16(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function findEndOfCentralDirectory(bytes: Uint8Array): number {
  const earliest = Math.max(0, bytes.length - 65_557);

  for (let offset = bytes.length - 22; offset >= earliest; offset -= 1) {
    const commentLength = readUint16(bytes, offset + 20);

    if (
      readUint32(bytes, offset) === END_OF_CENTRAL_DIRECTORY &&
      offset + 22 + commentLength === bytes.length
    ) {
      return offset;
    }
  }

  return -1;
}

function assertSafeArchiveMetadata(bytes: Uint8Array): void {
  const endOffset = findEndOfCentralDirectory(bytes);

  if (endOffset < 0) {
    throw new DocumentExtractionError(
      "INVALID_OFFICE_FILE",
      "The Office file is not a valid OOXML archive.",
    );
  }

  const entryCount = readUint16(bytes, endOffset + 10);
  const diskNumber = readUint16(bytes, endOffset + 4);
  const centralDirectoryDisk = readUint16(bytes, endOffset + 6);
  const entriesOnDisk = readUint16(bytes, endOffset + 8);
  const centralOffset = readUint32(bytes, endOffset + 16);

  if (
    diskNumber !== 0 ||
    centralDirectoryDisk !== 0 ||
    entriesOnDisk !== entryCount ||
    entryCount === 0xffff ||
    centralOffset === 0xffffffff ||
    entryCount > MAX_ARCHIVE_ENTRIES
  ) {
    throw new DocumentExtractionError(
      "OFFICE_ARCHIVE_LIMIT_EXCEEDED",
      `Office files are limited to ${MAX_ARCHIVE_ENTRIES} archive entries.`,
    );
  }

  let offset = centralOffset;
  let totalSize = 0;

  for (let index = 0; index < entryCount; index += 1) {
    if (
      offset + 46 > bytes.length ||
      readUint32(bytes, offset) !== CENTRAL_DIRECTORY_ENTRY
    ) {
      throw new DocumentExtractionError(
        "INVALID_OFFICE_FILE",
        "The Office archive directory is invalid.",
      );
    }

    const flags = readUint16(bytes, offset + 8);
    const uncompressedSize = readUint32(bytes, offset + 24);
    const filenameLength = readUint16(bytes, offset + 28);
    const extraLength = readUint16(bytes, offset + 30);
    const commentLength = readUint16(bytes, offset + 32);

    if ((flags & 1) !== 0) {
      throw new DocumentExtractionError(
        "OFFICE_FILE_ENCRYPTED",
        "Password-protected Office files are not supported.",
      );
    }

    totalSize += uncompressedSize;

    if (totalSize > MAX_UNCOMPRESSED_BYTES) {
      throw new DocumentExtractionError(
        "OFFICE_ARCHIVE_LIMIT_EXCEEDED",
        "The expanded Office file is too large to process safely.",
      );
    }

    offset += 46 + filenameLength + extraLength + commentLength;
  }
}

function normalizeArchivePath(value: string): string {
  const normalized = value.replaceAll("\\", "/").replace(/^\.\//u, "");

  if (
    !normalized ||
    normalized.startsWith("/") ||
    normalized.split("/").some((part) => part === "..") ||
    /^[a-z]:/iu.test(normalized)
  ) {
    throw new DocumentExtractionError(
      "INVALID_OFFICE_FILE",
      "The Office archive contains an unsafe entry path.",
    );
  }

  return normalized;
}

function isXmlPart(pathname: string): boolean {
  return (
    pathname === "[Content_Types].xml" ||
    pathname.endsWith(".xml") ||
    pathname.endsWith(".rels")
  );
}

function decodeXml(bytes: Uint8Array): string {
  try {
    if (bytes[0] === 0xff && bytes[1] === 0xfe) {
      return new TextDecoder("utf-16le", { fatal: true })
        .decode(bytes.slice(2))
        .replace(/^\uFEFF/u, "");
    }

    if (bytes[0] === 0xfe && bytes[1] === 0xff) {
      const length = bytes.byteLength - 2 - ((bytes.byteLength - 2) % 2);
      const swapped = new Uint8Array(length);

      for (let index = 0; index < length; index += 2) {
        swapped[index] = bytes[index + 3];
        swapped[index + 1] = bytes[index + 2];
      }

      return new TextDecoder("utf-16le", { fatal: true })
        .decode(swapped)
        .replace(/^\uFEFF/u, "");
    }

    const offset = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
      ? 3
      : 0;

    return new TextDecoder("utf-8", { fatal: true })
      .decode(bytes.slice(offset))
      .replace(/^\uFEFF/u, "");
  } catch {
    throw new DocumentExtractionError(
      "INVALID_OFFICE_FILE",
      "The Office file contains XML with an invalid encoding.",
    );
  }
}

function assertSafeXml(xml: string): void {
  if (/<!DOCTYPE|<!ENTITY/iu.test(xml)) {
    throw new DocumentExtractionError(
      "INVALID_OFFICE_FILE",
      "The Office file contains unsupported XML declarations.",
    );
  }
}

const xmlOptions = {
  attributeNamePrefix: "",
  ignoreAttributes: false,
  ignoreDeclaration: true,
  ignorePiTags: true,
  maxNestedTags: 100,
  parseAttributeValue: false,
  parseTagValue: false,
  processEntities: {
    enabled: true,
    maxEntityCount: 20,
    maxEntitySize: 1_000,
    maxExpandedLength: 50_000,
    maxExpansionDepth: 5,
    maxTotalExpansions: 100,
  },
  removeNSPrefix: true,
  strictReservedNames: true,
  trimValues: false,
} as const;

const objectXmlParser = new XMLParser(xmlOptions);
const namespacedObjectXmlParser = new XMLParser({
  ...xmlOptions,
  removeNSPrefix: false,
});
const orderedXmlParser = new XMLParser({
  ...xmlOptions,
  preserveOrder: true,
});

function parseXml<T>(xml: string, parser: XMLParser): T {
  assertSafeXml(xml);

  try {
    return parser.parse(xml) as T;
  } catch (error) {
    if (error instanceof DocumentExtractionError) {
      throw error;
    }

    throw new DocumentExtractionError(
      "INVALID_OFFICE_FILE",
      "The Office file contains invalid XML.",
    );
  }
}

export class OfficeArchive {
  constructor(
    private readonly files: Readonly<Record<string, Uint8Array>>,
    readonly paths: ReadonlySet<string>,
  ) {}

  has(pathname: string): boolean {
    return this.paths.has(pathname);
  }

  requireText(pathname: string): string {
    const bytes = this.files[pathname];

    if (!bytes) {
      throw new DocumentExtractionError(
        "INVALID_OFFICE_FILE",
        `The Office file is missing ${pathname}.`,
      );
    }

    return decodeXml(bytes);
  }

  parseObject(pathname: string): XmlRecord {
    return parseXml<XmlRecord>(this.requireText(pathname), objectXmlParser);
  }

  parseNamespacedObject(pathname: string): XmlRecord {
    return parseXml<XmlRecord>(
      this.requireText(pathname),
      namespacedObjectXmlParser,
    );
  }

  parseOrdered(pathname: string): OrderedXmlNode[] {
    return parseXml<OrderedXmlNode[]>(
      this.requireText(pathname),
      orderedXmlParser,
    );
  }
}

export function openOfficeArchive(content: ArrayBuffer): OfficeArchive {
  if (content.byteLength === 0) {
    throw new DocumentExtractionError(
      "EMPTY_DOCUMENT",
      "The Office file is empty.",
    );
  }

  const bytes = new Uint8Array(content);

  if (
    OLE_COMPOUND_SIGNATURE.every((value, index) => bytes[index] === value)
  ) {
    throw new DocumentExtractionError(
      "OFFICE_FILE_ENCRYPTED",
      "Password-protected or legacy binary Office files are not supported.",
    );
  }

  assertSafeArchiveMetadata(bytes);
  const paths = new Set<string>();
  let xmlSize = 0;

  try {
    const files = unzipSync(bytes, {
      filter(entry) {
        const pathname = normalizeArchivePath(entry.name);
        paths.add(pathname);

        if (/vbaProject\.bin$/iu.test(pathname)) {
          throw new DocumentExtractionError(
            "INVALID_OFFICE_FILE",
            "Macro-enabled Office files are not supported.",
          );
        }

        if (!isXmlPart(pathname)) {
          return false;
        }

        if (entry.originalSize > MAX_SINGLE_XML_BYTES) {
          throw new DocumentExtractionError(
            "OFFICE_ARCHIVE_LIMIT_EXCEEDED",
            "An Office XML component is too large to process safely.",
          );
        }

        xmlSize += entry.originalSize;

        if (xmlSize > MAX_XML_BYTES) {
          throw new DocumentExtractionError(
            "OFFICE_ARCHIVE_LIMIT_EXCEEDED",
            "The Office document contains too much expanded XML.",
          );
        }

        return true;
      },
    });
    const normalizedFiles = Object.fromEntries(
      Object.entries(files).map(([pathname, value]) => [
        normalizeArchivePath(pathname),
        value,
      ]),
    );
    const archive = new OfficeArchive(normalizedFiles, paths);
    const contentTypes = archive.requireText("[Content_Types].xml");

    if (/macroEnabled|vbaProject/iu.test(contentTypes)) {
      throw new DocumentExtractionError(
        "INVALID_OFFICE_FILE",
        "Macro-enabled Office files are not supported.",
      );
    }

    return archive;
  } catch (error) {
    if (error instanceof DocumentExtractionError) {
      throw error;
    }

    throw new DocumentExtractionError(
      "INVALID_OFFICE_FILE",
      "The Office file is damaged or uses unsupported compression.",
    );
  }
}

export function isXmlRecord(value: unknown): value is XmlRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function xmlArray(value: unknown): unknown[] {
  if (value === undefined || value === null) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

export function xmlText(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }

  if (Array.isArray(value)) {
    return value.map(xmlText).join("");
  }

  if (!isXmlRecord(value)) {
    return "";
  }

  if ("#text" in value) {
    return xmlText(value["#text"]);
  }

  return Object.entries(value)
    .filter(([key]) => key !== ":@")
    .map(([, child]) => xmlText(child))
    .join("");
}

export function orderedAttribute(
  node: OrderedXmlNode,
  attribute: string,
): string | undefined {
  const attributes = node[":@"];

  if (!isXmlRecord(attributes)) {
    return undefined;
  }

  const value = attributes[attribute];

  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : undefined;
}

export function orderedDescendants(
  nodes: readonly OrderedXmlNode[],
  tagName: string,
): OrderedXmlNode[] {
  const matches: OrderedXmlNode[] = [];

  for (const node of nodes) {
    for (const [key, value] of Object.entries(node)) {
      if (key === ":@" || !Array.isArray(value)) {
        continue;
      }

      if (key === tagName) {
        matches.push(node);
      }

      matches.push(...orderedDescendants(value as OrderedXmlNode[], tagName));
    }
  }

  return matches;
}

export function orderedChildren(
  node: OrderedXmlNode,
  tagName: string,
): OrderedXmlNode[] {
  const value = node[tagName];

  return Array.isArray(value) ? (value as OrderedXmlNode[]) : [];
}

export function orderedText(nodes: readonly OrderedXmlNode[]): string {
  let result = "";

  for (const node of nodes) {
    for (const [key, value] of Object.entries(node)) {
      if (key === ":@") {
        continue;
      }

      if (key === "#text") {
        result += xmlText(value);
      } else if (key === "tab") {
        result += "\t";
      } else if (key === "br" || key === "cr") {
        result += "\n";
      } else if (Array.isArray(value)) {
        result += orderedText(value as OrderedXmlNode[]);
      }
    }
  }

  return result;
}

export function resolveArchiveTarget(
  relationshipPart: string,
  target: string,
): string {
  const normalizedTarget = target.replaceAll("\\", "/");
  const base = relationshipPart.split("/").slice(0, -1);
  const parts = normalizedTarget.startsWith("/")
    ? []
    : base;

  for (const part of normalizedTarget.replace(/^\//u, "").split("/")) {
    if (!part || part === ".") {
      continue;
    }

    if (part === "..") {
      if (parts.length === 0) {
        throw new DocumentExtractionError(
          "INVALID_OFFICE_FILE",
          "An Office relationship points outside the archive.",
        );
      }

      parts.pop();
    } else {
      parts.push(part);
    }
  }

  return normalizeArchivePath(parts.join("/"));
}
