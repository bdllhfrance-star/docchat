import { describe, expect, test } from "vitest";

import {
  canSendMessage,
  canTransitionDocumentStatus,
  isProcessingDocumentStatus,
} from "./status";

describe("document status transitions", () => {
  test("allows the complete ingestion path", () => {
    const path = [
      "queued",
      "uploading",
      "validating",
      "extracting",
      "chunking",
      "embedding",
      "indexing",
      "ready",
    ] as const;

    for (let index = 0; index < path.length - 1; index += 1) {
      expect(canTransitionDocumentStatus(path[index], path[index + 1])).toBe(
        true,
      );
    }
  });

  test("allows active stages to fail", () => {
    const activeStatuses = [
      "queued",
      "uploading",
      "validating",
      "extracting",
      "chunking",
      "embedding",
      "indexing",
    ] as const;

    for (const status of activeStatuses) {
      expect(canTransitionDocumentStatus(status, "failed")).toBe(true);
    }
  });

  test("rejects skipped and terminal transitions", () => {
    expect(canTransitionDocumentStatus("uploading", "embedding")).toBe(false);
    expect(canTransitionDocumentStatus("indexing", "extracting")).toBe(false);
    expect(canTransitionDocumentStatus("ready", "failed")).toBe(false);
  });

  test("allows retry from the uploaded file or from a replacement", () => {
    expect(canTransitionDocumentStatus("failed", "validating")).toBe(true);
    expect(canTransitionDocumentStatus("failed", "uploading")).toBe(true);
  });
});

describe("chat availability", () => {
  test("requires at least one ready document", () => {
    expect(canSendMessage([])).toBe(false);
    expect(canSendMessage(["ready"])).toBe(true);
  });

  test("stays blocked while any document is processing or failed", () => {
    expect(canSendMessage(["ready", "embedding"])).toBe(false);
    expect(canSendMessage(["ready", "failed"])).toBe(false);
  });
});

test("identifies processing statuses", () => {
  expect(isProcessingDocumentStatus("chunking")).toBe(true);
  expect(isProcessingDocumentStatus("ready")).toBe(false);
  expect(isProcessingDocumentStatus("failed")).toBe(false);
});
