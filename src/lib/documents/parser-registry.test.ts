// @vitest-environment node

import { describe, expect, test } from "vitest";

import { supportedFileTypes } from "@/types/documents";

import { getDocumentParser } from "./parser-registry";

describe("document parser registry", () => {
  test("has one working parser registration for every advertised format", () => {
    for (const fileType of supportedFileTypes) {
      expect(getDocumentParser(fileType).supports(fileType)).toBe(true);
    }
  });
});
