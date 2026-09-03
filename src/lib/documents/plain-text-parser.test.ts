// @vitest-environment node

import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, test } from "vitest";

import { markdownParser, txtParser } from "./plain-text-parser";

function utf8(value: string): ArrayBuffer {
  return new TextEncoder().encode(value).buffer;
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

describe("plain text parsers", () => {
  test("keeps exact TXT line ranges and readable content", async () => {
    const blocks = await txtParser.extract(
      utf8("\nAccount\nReference: ZX-104\n\nAmount: 120.50 EUR\n"),
    );

    expect(blocks).toEqual([
      {
        text: "Account\nReference: ZX-104\n\nAmount: 120.50 EUR",
        source: { label: "Lines 2-6", lineStart: 2, lineEnd: 6 },
      },
    ]);
  });

  test("extracts the deployed TXT retrieval fixture with its location", async () => {
    await expect(
      txtParser.extract(await fixture("multiformat-smoke.txt")),
    ).resolves.toEqual([
      {
        text: [
          "DocChat multi-format validation",
          "",
          "Project: Orion",
          "Approval code: TXT-7319",
          "Payment window: 30 days",
          "Responsible team: Quality Engineering",
        ].join("\n"),
        source: { label: "Lines 1-7", lineStart: 1, lineEnd: 7 },
      },
    ]);
  });

  test("extracts the deployed Markdown fixture with heading ancestry", async () => {
    await expect(
      markdownParser.extract(await fixture("operations-smoke.md")),
    ).resolves.toContainEqual({
      text: "## Escalation\nEscalation owner: Nadia Benali. Target response: 4 hours.",
      source: {
        label: "Operations › Escalation · Lines 3-5",
        section: "Operations › Escalation",
        lineStart: 3,
        lineEnd: 5,
      },
    });
  });

  test("supports UTF-16 text with a byte-order mark", async () => {
    const encoded = new TextEncoder().encode("Résumé");
    const utf16 = new Uint8Array(2 + "Résumé".length * 2);
    utf16.set([0xff, 0xfe]);

    [..."Résumé"].forEach((character, index) => {
      const code = character.charCodeAt(0);
      utf16[2 + index * 2] = code & 0xff;
      utf16[3 + index * 2] = code >> 8;
    });

    expect(encoded.byteLength).toBeGreaterThan(0);
    await expect(txtParser.extract(utf16.buffer)).resolves.toMatchObject([
      { text: "Résumé", source: { label: "Line 1" } },
    ]);
  });

  test("preserves Markdown heading ancestry and line positions", async () => {
    const blocks = await markdownParser.extract(
      utf8("Intro\n\n# Contract\nOverview\n## Payment\nDue in 30 days"),
    );

    expect(blocks).toEqual([
      {
        text: "Intro",
        source: { label: "Lines 1-2", lineStart: 1, lineEnd: 2 },
      },
      {
        text: "# Contract\nOverview",
        source: {
          label: "Contract · Lines 3-4",
          section: "Contract",
          lineStart: 3,
          lineEnd: 4,
        },
      },
      {
        text: "## Payment\nDue in 30 days",
        source: {
          label: "Contract › Payment · Lines 5-6",
          section: "Contract › Payment",
          lineStart: 5,
          lineEnd: 6,
        },
      },
    ]);
  });

  test("rejects binary content presented as text", async () => {
    await expect(
      txtParser.extract(Uint8Array.from([0, 1, 2, 3, 4, 5]).buffer),
    ).rejects.toMatchObject({ code: "INVALID_TEXT_ENCODING" });
  });
});
