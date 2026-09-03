import type { DocumentBlock, DocumentParser } from "@/types/documents";

import {
  openOfficeArchive,
  orderedAttribute,
  orderedChildren,
  orderedDescendants,
  orderedText,
  type OrderedXmlNode,
} from "./office-archive";
import { DocumentExtractionError } from "./parser-error";

type ParagraphStyle = {
  level?: number;
  name: string;
};

function normalizeInlineText(text: string): string {
  return text
    .replace(/[ \t]+\n/gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

function paragraphText(paragraph: OrderedXmlNode): string {
  return normalizeInlineText(orderedText(orderedChildren(paragraph, "p")));
}

function headingLevel(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const match = /(?:heading|titre)\s*([1-6])/iu.exec(value);

  if (match) {
    return Number(match[1]);
  }

  return /^title$|^titre$/iu.test(value) ? 1 : undefined;
}

function parseStyles(root: readonly OrderedXmlNode[]): Map<string, ParagraphStyle> {
  const styles = new Map<string, ParagraphStyle>();

  for (const style of orderedDescendants(root, "style")) {
    if (orderedAttribute(style, "type") !== "paragraph") {
      continue;
    }

    const id = orderedAttribute(style, "styleId");

    if (!id) {
      continue;
    }

    const children = orderedChildren(style, "style");
    const nameNode = orderedDescendants(children, "name")[0];
    const outlineNode = orderedDescendants(children, "outlineLvl")[0];
    const name = orderedAttribute(nameNode ?? {}, "val") ?? id;
    const outline = Number(orderedAttribute(outlineNode ?? {}, "val"));
    const level = Number.isInteger(outline) && outline >= 0 && outline < 6
      ? outline + 1
      : headingLevel(name) ?? headingLevel(id);

    styles.set(id, { name, ...(level ? { level } : {}) });
  }

  return styles;
}

function paragraphHeadingLevel(
  paragraph: OrderedXmlNode,
  styles: ReadonlyMap<string, ParagraphStyle>,
): number | undefined {
  const children = orderedChildren(paragraph, "p");
  const styleNode = orderedDescendants(children, "pStyle")[0];
  const styleId = orderedAttribute(styleNode ?? {}, "val");
  const outlineNode = orderedDescendants(children, "outlineLvl")[0];
  const outline = Number(orderedAttribute(outlineNode ?? {}, "val"));

  if (Number.isInteger(outline) && outline >= 0 && outline < 6) {
    return outline + 1;
  }

  return styles.get(styleId ?? "")?.level ?? headingLevel(styleId);
}

function tableText(table: OrderedXmlNode): string {
  const rows = orderedDescendants(orderedChildren(table, "tbl"), "tr")
    .map((row) => {
      const cells = orderedChildren(row, "tr")
        .filter((node) => "tc" in node)
        .map((cell) => {
          const paragraphs = orderedDescendants(
            orderedChildren(cell, "tc"),
            "p",
          )
            .map(paragraphText)
            .filter(Boolean);

          return paragraphs.join(" / ");
        });

      return cells.some(Boolean) ? cells.join(" | ") : "";
    })
    .filter(Boolean);

  return rows.length > 0 ? `Table:\n${rows.join("\n")}` : "";
}

function bodyContent(nodes: readonly OrderedXmlNode[]): OrderedXmlNode[] {
  const content: OrderedXmlNode[] = [];

  for (const node of nodes) {
    if ("p" in node || "tbl" in node) {
      content.push(node);
      continue;
    }

    for (const [key, value] of Object.entries(node)) {
      if (key !== ":@" && Array.isArray(value)) {
        content.push(...bodyContent(value as OrderedXmlNode[]));
      }
    }
  }

  return content;
}

function docxBlocks(
  root: readonly OrderedXmlNode[],
  styles: ReadonlyMap<string, ParagraphStyle>,
): DocumentBlock[] {
  const body = orderedDescendants(root, "body")[0];

  if (!body) {
    throw new DocumentExtractionError(
      "INVALID_OFFICE_FILE",
      "The DOCX document body is missing.",
    );
  }

  const headings: string[] = [];
  const blocks: DocumentBlock[] = [];
  let section = "Document";
  let parts: string[] = [];

  const flush = () => {
    const text = parts.join("\n\n").trim();

    if (text) {
      blocks.push({
        text,
        source: {
          label: `Section ${section}`,
          section,
        },
      });
    }

    parts = [];
  };

  for (const node of bodyContent(orderedChildren(body, "body"))) {
    if ("p" in node) {
      const text = paragraphText(node);

      if (!text) {
        continue;
      }

      const level = paragraphHeadingLevel(node, styles);

      if (level) {
        flush();
        headings.length = level - 1;
        headings[level - 1] = text.slice(0, 180);
        section = headings.filter(Boolean).join(" › ").slice(0, 500);
      }

      parts.push(text);
    } else if ("tbl" in node) {
      const text = tableText(node);

      if (text) {
        parts.push(text);
      }
    }
  }

  flush();

  if (blocks.length === 0) {
    throw new DocumentExtractionError(
      "NO_EXTRACTABLE_TEXT",
      "The DOCX file contains no readable paragraphs or tables.",
    );
  }

  return blocks;
}

export const docxParser: DocumentParser = {
  supports(fileType) {
    return fileType === "docx";
  },

  async extract(content) {
    const archive = openOfficeArchive(content);
    const contentTypes = archive.requireText("[Content_Types].xml");

    if (!contentTypes.includes("wordprocessingml.document.main+xml")) {
      throw new DocumentExtractionError(
        "INVALID_OFFICE_FILE",
        "The archive is not a valid DOCX document.",
      );
    }

    const styles = archive.has("word/styles.xml")
      ? parseStyles(archive.parseOrdered("word/styles.xml"))
      : new Map<string, ParagraphStyle>();

    return docxBlocks(
      archive.parseOrdered("word/document.xml"),
      styles,
    );
  },
};
