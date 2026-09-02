import { describe, expect, test } from "vitest";

import {
  MAX_BATCH_SIZE_BYTES,
  MAX_FILE_SIZE_BYTES,
  MAX_FILES_PER_BATCH,
  isSafeFilename,
  normalizeFilename,
  validateBatchFiles,
  type FileLike,
} from "./validation";

function file(overrides: Partial<FileLike> = {}): FileLike {
  return {
    name: "guide.pdf",
    size: 1024,
    type: "application/pdf",
    ...overrides,
  };
}

describe("batch file validation", () => {
  test("accepts the supported modern formats", () => {
    const result = validateBatchFiles([
      file(),
      file({
        name: "report.docx",
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      }),
      file({ name: "notes.md", type: "text/markdown" }),
      file({ name: "table.csv", type: "text/csv" }),
    ]);

    expect(result.isValid).toBe(true);
    expect(result.files.map((entry) => entry.fileType)).toEqual([
      "pdf",
      "docx",
      "md",
      "csv",
    ]);
  });

  test("allows an empty browser MIME type for server-side verification", () => {
    expect(validateBatchFiles([file({ type: "" })]).isValid).toBe(true);
  });

  test("rejects empty, oversized, unsupported, and mismatched files", () => {
    const result = validateBatchFiles([
      file({ size: 0 }),
      file({ name: "large.pdf", size: MAX_FILE_SIZE_BYTES + 1 }),
      file({ name: "legacy.doc", type: "application/msword" }),
      file({ type: "text/plain" }),
    ]);

    expect(result.files.map((entry) => entry.errors)).toEqual([
      ["EMPTY_FILE"],
      ["FILE_TOO_LARGE"],
      ["UNSUPPORTED_FILE_TYPE"],
      ["MIME_TYPE_MISMATCH"],
    ]);
    expect(result.isValid).toBe(false);
  });

  test("enforces file count and total batch size", () => {
    const tooMany = Array.from({ length: MAX_FILES_PER_BATCH + 1 }, (_, index) =>
      file({ name: `${index}.pdf` }),
    );
    const tooLarge = Array.from({ length: 6 }, (_, index) =>
      file({ name: `${index}.pdf`, size: MAX_BATCH_SIZE_BYTES / 5 }),
    );

    expect(validateBatchFiles(tooMany).errors).toContain("TOO_MANY_FILES");
    expect(validateBatchFiles(tooLarge).errors).toContain("BATCH_TOO_LARGE");
  });

  test("requires at least one file", () => {
    expect(validateBatchFiles([]).isValid).toBe(false);
  });

  test("rejects path separators, control characters, bidi controls, and long names", () => {
    expect(isSafeFilename("résumé.pdf")).toBe(true);
    expect(isSafeFilename("../guide.pdf")).toBe(false);
    expect(isSafeFilename("folder\\guide.pdf")).toBe(false);
    expect(isSafeFilename("guide\u0000.pdf")).toBe(false);
    expect(isSafeFilename("guide\u202efdp.pdf")).toBe(false);
    expect(isSafeFilename(`${"a".repeat(252)}.pdf`)).toBe(false);

    expect(
      validateBatchFiles([file({ name: "../guide.pdf" })]).files[0].errors,
    ).toContain("UNSAFE_FILENAME");
  });

  test("normalizes accepted Unicode filenames to NFC", () => {
    expect(normalizeFilename("  re\u0301sume\u0301.pdf  ")).toBe("résumé.pdf");
  });
});
