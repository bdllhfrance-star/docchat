// @vitest-environment node

import { describe, expect, test } from "vitest";

import { csvParser } from "./csv-parser";

function csv(value: string): ArrayBuffer {
  return new TextEncoder().encode(value).buffer;
}

describe("CSV parser", () => {
  test("detects semicolons and retains headers, quoted values, and line ranges", async () => {
    const blocks = await csvParser.extract(
      csv('Name;Note;Amount\nAlice;"Priority; client";42\nBob;"Two\nlines";7'),
    );

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      source: { label: "Lines 2-4", lineStart: 2, lineEnd: 4 },
    });
    expect(blocks[0].text).toContain(
      "Row 2: Name: Alice | Note: Priority; client | Amount: 42",
    );
    expect(blocks[0].text).toContain(
      "Row 3: Name: Bob | Note: Two lines | Amount: 7",
    );
  });

  test("reports malformed quoted fields", async () => {
    await expect(
      csvParser.extract(csv('Name,Note\nAlice,"unfinished')),
    ).rejects.toMatchObject({ code: "INVALID_CSV" });
    await expect(
      csvParser.extract(csv('Name,Note\nAlice,"closed"unexpected')),
    ).rejects.toMatchObject({ code: "INVALID_CSV" });
  });
});
