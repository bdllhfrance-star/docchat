import { describe, expect, test } from "vitest";

import { MAX_FILE_SIZE_BYTES } from "./validation";
import { createBatchRequestSchema, parseBatchManifest } from "./manifest";

const validFile = {
  clientId: "5f36e79a-30b9-4866-9157-524d7de72af3",
  filename: "guide.pdf",
  size: 1024,
  mimeType: "application/pdf",
};

describe("batch manifest", () => {
  test("parses and normalizes a valid request", () => {
    expect(parseBatchManifest({ files: [validFile] })).toEqual({
      files: [{ ...validFile, fileType: "pdf" }],
    });
  });

  test("rejects unsupported, oversized, and mismatched files", () => {
    const result = createBatchRequestSchema.safeParse({
      files: [
        { ...validFile, filename: "legacy.doc", mimeType: "application/msword" },
        { ...validFile, size: MAX_FILE_SIZE_BYTES + 1 },
        { ...validFile, mimeType: "text/plain" },
      ],
    });

    expect(result.success).toBe(false);

    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.message)).toEqual(
        expect.arrayContaining([
          "UNSUPPORTED_FILE_TYPE",
          "FILE_TOO_LARGE",
          "MIME_TYPE_MISMATCH",
        ]),
      );
    }
  });

  test("rejects malformed IDs, unknown fields, and empty requests", () => {
    expect(
      createBatchRequestSchema.safeParse({
        files: [{ ...validFile, clientId: "client-controlled" }],
      }).success,
    ).toBe(false);
    expect(
      createBatchRequestSchema.safeParse({
        files: [{ ...validFile, sessionId: "must-not-be-accepted" }],
      }).success,
    ).toBe(false);
    expect(createBatchRequestSchema.safeParse({ files: [] }).success).toBe(
      false,
    );
  });
});
