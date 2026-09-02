// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test } from "vitest";

const styles = readFileSync(resolve("src/app/globals.css"), "utf8");

test("defines operation-specific document animations", () => {
  for (const animation of [
    "document-upload",
    "document-scan",
    "document-line-reveal",
    "document-chunk-separate",
    "document-vector-build",
    "document-index-settle",
    "document-ready-pop",
    "document-failure",
    "document-retry",
    "document-delete",
  ]) {
    expect(styles).toContain(`@keyframes ${animation}`);
  }
});

test("turns off document movement when reduced motion is requested", () => {
  expect(styles).toContain("@media (prefers-reduced-motion: reduce)");
  expect(styles).toContain("animation: none !important");
  expect(styles).toContain("transition: none !important");
});
