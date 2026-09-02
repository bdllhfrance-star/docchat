// @vitest-environment node

import { describe, expect, test, vi } from "vitest";

import type { DocumentChunk } from "@/lib/rag/chunking";
import type { DocumentStatus } from "@/types/documents";
import type { DocumentRecord } from "@/types/persistence";

import { ingestUploadedDocument } from "./ingestion";
import { PdfExtractionError } from "./pdf-parser";

const document: DocumentRecord = {
  id: "e267df76-9b0e-4616-b187-0252faf57880",
  clientId: "5f36e79a-30b9-4866-9157-524d7de72af3",
  batchId: "9f92701f-4866-45e6-b21f-1be3decc8d7d",
  sessionId: "271bf840-1fed-443d-86fb-a82b0bd70465",
  filename: "guide.pdf",
  mimeType: "application/pdf",
  fileType: "pdf",
  blobPathname: "documents/batch/document.pdf",
  blobUrl: "https://blob.example/guide.pdf",
  size: 100,
  status: "validating",
  createdAt: new Date("2026-09-02T12:00:00.000Z"),
  expiresAt: new Date("2026-09-09T12:00:00.000Z"),
};

function dependencies() {
  let status: DocumentStatus = "validating";
  const transitionDocumentStatus = vi.fn(
    async (
      _ownership: unknown,
      from: DocumentStatus,
      to: DocumentStatus,
    ) => {
      if (status !== from) {
        return null;
      }

      status = to;
      return { ...document, status };
    },
  );
  const failDocumentProcessing = vi.fn(async ({ error }) => {
    status = "failed";
    return { ...document, status, error };
  });
  const completeDocumentIndexing = vi.fn(async () => {
    status = "ready";
    return { ...document, status };
  });

  return {
    repository: {
      transitionDocumentStatus,
      failDocumentProcessing,
      completeDocumentIndexing,
    },
    loadDocument: vi.fn(async () => new ArrayBuffer(8)),
    extract: vi.fn(async () => [
      { text: "First page text", source: { label: "Page 1", page: 1 } },
      { text: "Second page text", source: { label: "Page 2", page: 2 } },
    ]),
    embed: vi.fn(async (chunks: readonly DocumentChunk[]) =>
      chunks.map((chunk) => ({
        ...chunk,
        embedding: Array.from({ length: 768 }, () => 0.1),
      })),
    ),
    createId: vi
      .fn()
      .mockReturnValueOnce("9fa30895-982e-464f-93c7-b137b549fe52")
      .mockReturnValueOnce("fe0e9563-666e-4427-bf9f-98baac6b4f3c"),
    now: () => new Date("2026-09-02T12:01:00.000Z"),
  };
}

describe("uploaded document ingestion", () => {
  test("runs the PDF pipeline and persists sourced vectors before ready", async () => {
    const deps = dependencies();

    await expect(ingestUploadedDocument(document, deps)).resolves.toMatchObject({
      outcome: "ready",
      document: { status: "ready" },
    });
    expect(deps.repository.transitionDocumentStatus.mock.calls).toEqual([
      [expect.any(Object), "validating", "extracting"],
      [expect.any(Object), "extracting", "chunking"],
      [expect.any(Object), "chunking", "embedding"],
      [expect.any(Object), "embedding", "indexing"],
    ]);
    expect(deps.repository.completeDocumentIndexing).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: document.sessionId,
        batchId: document.batchId,
        documentId: document.id,
        chunks: [
          expect.objectContaining({
            filename: "guide.pdf",
            text: "First page text",
            source: { label: "Page 1", page: 1 },
            embedding: expect.any(Array),
          }),
          expect.objectContaining({
            text: "Second page text",
            source: { label: "Page 2", page: 2 },
          }),
        ],
      }),
    );
  });

  test("isolates a parsing failure on the document", async () => {
    const deps = dependencies();
    deps.extract.mockRejectedValueOnce(
      new PdfExtractionError("INVALID_PDF", "The PDF is invalid."),
    );

    await expect(ingestUploadedDocument(document, deps)).resolves.toMatchObject({
      outcome: "failed",
      document: { status: "failed" },
    });
    expect(deps.repository.failDocumentProcessing).toHaveBeenCalledWith(
      expect.objectContaining({
        error: {
          code: "INVALID_PDF",
          message: "The PDF is invalid.",
        },
      }),
    );
    expect(deps.repository.completeDocumentIndexing).not.toHaveBeenCalled();
  });

  test("fails explicitly when a format parser is not available yet", async () => {
    const deps = dependencies();

    await expect(
      ingestUploadedDocument({ ...document, fileType: "docx" }, deps),
    ).resolves.toMatchObject({ outcome: "failed" });
    expect(deps.loadDocument).not.toHaveBeenCalled();
    expect(deps.repository.failDocumentProcessing).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ code: "PARSER_NOT_AVAILABLE" }),
      }),
    );
  });

  test("skips a callback when another invocation already claimed the document", async () => {
    const deps = dependencies();
    deps.repository.transitionDocumentStatus.mockResolvedValueOnce(null);

    await expect(ingestUploadedDocument(document, deps)).resolves.toEqual({
      outcome: "skipped",
    });
    expect(deps.extract).not.toHaveBeenCalled();
    expect(deps.repository.failDocumentProcessing).not.toHaveBeenCalled();
  });
});
