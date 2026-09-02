import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";

import {
  DocumentOperationIcon,
  type DocumentOperationState,
} from "./document-operation-icon";

afterEach(cleanup);

test("provides a distinct SVG state for every document operation", () => {
  const states: DocumentOperationState[] = [
    "selected",
    "queued",
    "upload-transfer",
    "uploading",
    "validating",
    "extracting",
    "chunking",
    "embedding",
    "indexing",
    "ready",
    "failed",
    "retrying",
    "replacing",
    "deleting",
  ];
  const { container } = render(
    <div>
      {states.map((state) => (
        <DocumentOperationIcon key={state} state={state} />
      ))}
    </div>,
  );

  for (const state of states) {
    expect(container.querySelector(`[data-operation="${state}"]`)).not.toBeNull();
  }

  expect(container.querySelectorAll(".document-extract-line")).toHaveLength(3);
  expect(container.querySelectorAll(".document-vector-dot")).toHaveLength(5);
  expect(container.querySelectorAll(".document-chunk-group rect")).toHaveLength(4);
});
