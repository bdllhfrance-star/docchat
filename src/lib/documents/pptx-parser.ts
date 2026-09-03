import type { DocumentBlock, DocumentParser } from "@/types/documents";

import {
  isXmlRecord,
  openOfficeArchive,
  orderedAttribute,
  orderedChildren,
  orderedDescendants,
  orderedText,
  resolveArchiveTarget,
  xmlArray,
  type OfficeArchive,
  type OrderedXmlNode,
  type XmlRecord,
} from "./office-archive";
import { DocumentExtractionError } from "./parser-error";

export const MAX_PPTX_SLIDES = 100;

function childRecord(record: XmlRecord, key: string): XmlRecord | undefined {
  const value = record[key];

  return isXmlRecord(value) ? value : undefined;
}

function slideParts(archive: OfficeArchive): string[] {
  const presentation = archive.parseNamespacedObject("ppt/presentation.xml");
  const root = childRecord(presentation, "p:presentation");
  const slideList = root && childRecord(root, "p:sldIdLst");
  const slideIds = slideList ? xmlArray(slideList["p:sldId"]) : [];
  const relationships = archive.parseObject(
    "ppt/_rels/presentation.xml.rels",
  );
  const relationshipRoot = childRecord(relationships, "Relationships");
  const targets = new Map<string, string>();

  for (const value of relationshipRoot
    ? xmlArray(relationshipRoot.Relationship)
    : []) {
    if (!isXmlRecord(value) || value.TargetMode === "External") {
      continue;
    }

    const id = typeof value.Id === "string" ? value.Id : undefined;
    const target = typeof value.Target === "string" ? value.Target : undefined;

    if (id && target) {
      targets.set(id, resolveArchiveTarget("ppt/presentation.xml", target));
    }
  }

  const parts = slideIds.map((value) => {
    if (!isXmlRecord(value)) {
      return "";
    }

    const relationshipId = value["r:id"];
    const target = typeof relationshipId === "string"
      ? targets.get(relationshipId)
      : undefined;

    if (!target || !archive.has(target)) {
      throw new DocumentExtractionError(
        "INVALID_OFFICE_FILE",
        "The PPTX slide order or relationship map is invalid.",
      );
    }

    return target;
  });

  if (parts.length === 0 || parts.some((part) => !part)) {
    throw new DocumentExtractionError(
      "INVALID_OFFICE_FILE",
      "The PPTX presentation contains no valid slides.",
    );
  }

  if (parts.length > MAX_PPTX_SLIDES) {
    throw new DocumentExtractionError(
      "PPTX_TOO_MANY_SLIDES",
      `PPTX files are limited to ${MAX_PPTX_SLIDES} slides.`,
    );
  }

  return parts;
}

function normalizedSlideText(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

function shapeText(shape: OrderedXmlNode): string {
  const paragraphs = orderedDescendants(orderedChildren(shape, "sp"), "p")
    .map((paragraph) =>
      normalizedSlideText(orderedText(orderedChildren(paragraph, "p"))),
    )
    .filter(Boolean);

  return paragraphs.join("\n");
}

function isTitleShape(shape: OrderedXmlNode): boolean {
  return orderedDescendants(orderedChildren(shape, "sp"), "ph").some(
    (placeholder) => {
      const type = orderedAttribute(placeholder, "type");

      return type === "title" || type === "ctrTitle";
    },
  );
}

function slideTableText(table: OrderedXmlNode): string {
  const rows = orderedDescendants(orderedChildren(table, "tbl"), "tr")
    .map((row) => {
      const cells = orderedChildren(row, "tr")
        .filter((node) => "tc" in node)
        .map((cell) => {
          const paragraphs = orderedDescendants(
            orderedChildren(cell, "tc"),
            "p",
          )
            .map((paragraph) =>
              normalizedSlideText(
                orderedText(orderedChildren(paragraph, "p")),
              ),
            )
            .filter(Boolean);

          return paragraphs.join(" / ");
        });

      return cells.some(Boolean) ? cells.join(" | ") : "";
    })
    .filter(Boolean);

  return rows.length > 0 ? `Table:\n${rows.join("\n")}` : "";
}

function slideBlock(
  root: readonly OrderedXmlNode[],
  slideNumber: number,
): DocumentBlock | null {
  const shapes = orderedDescendants(root, "sp");
  const titleShape = shapes.find(isTitleShape);
  const title = titleShape ? shapeText(titleShape) : "";
  const body = shapes
    .filter((shape) => shape !== titleShape)
    .map(shapeText)
    .filter(Boolean);
  const tables = orderedDescendants(root, "tbl")
    .map(slideTableText)
    .filter(Boolean);
  const text = [
    ...(title ? [`Title: ${title}`] : []),
    ...body,
    ...tables,
  ]
    .join("\n\n")
    .trim();

  if (!text) {
    return null;
  }

  const conciseTitle = title.replace(/\s+/gu, " ").slice(0, 120);
  const label = conciseTitle
    ? `Slide ${slideNumber} - ${conciseTitle}`
    : `Slide ${slideNumber}`;

  return {
    text,
    source: {
      label,
      slide: slideNumber,
      ...(conciseTitle ? { section: conciseTitle } : {}),
    },
  };
}

export const pptxParser: DocumentParser = {
  supports(fileType) {
    return fileType === "pptx";
  },

  async extract(content) {
    const archive = openOfficeArchive(content);
    const contentTypes = archive.requireText("[Content_Types].xml");

    if (!contentTypes.includes("presentationml.presentation.main+xml")) {
      throw new DocumentExtractionError(
        "INVALID_OFFICE_FILE",
        "The archive is not a valid PPTX presentation.",
      );
    }

    const blocks = slideParts(archive)
      .map((part, index) =>
        slideBlock(archive.parseOrdered(part), index + 1),
      )
      .filter((block): block is DocumentBlock => block !== null);

    if (blocks.length === 0) {
      throw new DocumentExtractionError(
        "NO_EXTRACTABLE_TEXT",
        "The PPTX file contains no readable slide text or tables.",
      );
    }

    return blocks;
  },
};
