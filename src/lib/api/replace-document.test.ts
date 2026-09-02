import { describe, expect, test, vi } from "vitest";

import type { ReplaceDocumentDependencies } from "@/lib/api/replace-document";
import type { DocumentRecord } from "@/types/persistence";

import { handleReplaceDocument } from "./replace-document";

const documentId = "e267df76-9b0e-4616-b187-0252faf57880";
const batchId = "9f92701f-4866-45e6-b21f-1be3decc8d7d";
const sessionId = "271bf840-1fed-443d-86fb-a82b0bd70465";
const replacementClientId = "5f36e79a-30b9-4866-9157-524d7de72af3";

function document(overrides: Partial<DocumentRecord> = {}): DocumentRecord {
  return {
    id: documentId,
    clientId: "69645762-69de-4f03-a2c1-b6f07a94f5b7",
    batchId,
    sessionId,
    filename: "broken.pdf",
    mimeType: "application/pdf",
    fileType: "pdf",
    blobPathname: `documents/${batchId}/${documentId}.pdf`,
    blobUrl: "https://blob.example/broken.pdf",
    size: 1024,
    status: "failed",
    error: { code: "INVALID_PDF", message: "The PDF is invalid." },
    createdAt: new Date("2026-09-02T08:00:00.000Z"),
    expiresAt: new Date("2026-09-09T08:00:00.000Z"),
    ...overrides,
  };
}

function request(
  overrides: Partial<{
    clientId: string;
    filename: string;
    size: number;
    mimeType: string;
  }> = {},
): Request {
  return new Request("http://localhost/api/documents/id/replace", {
    method: "POST",
    body: JSON.stringify({
      clientId: replacementClientId,
      filename: "replacement.xlsx",
      size: 2048,
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ...overrides,
    }),
  });
}

function dependencies(
  overrides: Partial<ReplaceDocumentDependencies> = {},
): ReplaceDocumentDependencies {
  const original = document();
  const prepared = document({
    clientId: replacementClientId,
    filename: "replacement.xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    fileType: "xlsx",
    blobPathname: `documents/${batchId}/${documentId}.xlsx`,
    blobUrl: undefined,
    size: 2048,
    status: "queued",
    error: undefined,
  });

  return {
    requireSession: vi.fn().mockResolvedValue(sessionId),
    findDocument: vi.fn().mockResolvedValue(original),
    findDocumentsByBatch: vi.fn().mockResolvedValue([original]),
    prepareDocumentReplacement: vi.fn().mockResolvedValue(prepared),
    restoreDocumentReplacement: vi.fn().mockResolvedValue(original),
    deleteBlob: vi.fn().mockResolvedValue(undefined),
    requestId: () => "request-123",
    ...overrides,
  };
}

describe("replace document API", () => {
  test("prepares the same document for the existing secure upload flow", async () => {
    const order: string[] = [];
    const deps = dependencies({
      prepareDocumentReplacement: vi.fn(async () => {
        order.push("database");
        return document({
          clientId: replacementClientId,
          filename: "replacement.xlsx",
          fileType: "xlsx",
          mimeType:
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          blobPathname: `documents/${batchId}/${documentId}.xlsx`,
          blobUrl: undefined,
          size: 2048,
          status: "queued",
          error: undefined,
        });
      }),
      deleteBlob: vi.fn(async () => {
        order.push("blob");
      }),
    });

    const response = await handleReplaceDocument(request(), documentId, deps);

    expect(response.status).toBe(200);
    expect(order).toEqual(["database", "blob"]);
    expect(deps.prepareDocumentReplacement).toHaveBeenCalledWith({
      sessionId,
      batchId,
      documentId,
      clientId: replacementClientId,
      filename: "replacement.xlsx",
      size: 2048,
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      fileType: "xlsx",
      blobPathname: `documents/${batchId}/${documentId}.xlsx`,
    });
    await expect(response.json()).resolves.toMatchObject({
      document: {
        id: documentId,
        filename: "replacement.xlsx",
        status: "queued",
      },
      uploadPathname: `documents/${batchId}/${documentId}.xlsx`,
    });
  });

  test("rejects a replacement that would exceed the batch limit", async () => {
    const original = document({ size: 1024 });
    const deps = dependencies({
      findDocument: vi.fn().mockResolvedValue(original),
      findDocumentsByBatch: vi.fn().mockResolvedValue([
        original,
        document({ id: "80ca62f0-dac4-49c3-aef2-60f0f2b4c1ae", size: 45 * 1024 * 1024 }),
      ]),
    });

    const response = await handleReplaceDocument(
      request({ size: 6 * 1024 * 1024 }),
      documentId,
      deps,
    );

    expect(response.status).toBe(413);
    expect(deps.prepareDocumentReplacement).not.toHaveBeenCalled();
  });

  test("rejects an unsupported replacement before touching persistence", async () => {
    const deps = dependencies();
    const response = await handleReplaceDocument(
      request({ filename: "malware.exe", mimeType: "application/octet-stream" }),
      documentId,
      deps,
    );

    expect(response.status).toBe(415);
    expect(deps.requireSession).not.toHaveBeenCalled();
    expect(deps.prepareDocumentReplacement).not.toHaveBeenCalled();
  });

  test("only replaces failed documents owned by the current session", async () => {
    const deps = dependencies({
      findDocument: vi.fn().mockResolvedValue(document({ status: "ready" })),
    });

    const response = await handleReplaceDocument(request(), documentId, deps);

    expect(response.status).toBe(409);
    expect(deps.prepareDocumentReplacement).not.toHaveBeenCalled();
  });

  test("restores the failed record if deletion of the previous Blob fails", async () => {
    const deps = dependencies({
      deleteBlob: vi.fn().mockRejectedValue(new Error("Blob unavailable")),
    });

    const response = await handleReplaceDocument(request(), documentId, deps);

    expect(response.status).toBe(502);
    expect(deps.restoreDocumentReplacement).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId,
        batchId,
        documentId,
        replacementClientId,
      }),
    );
  });

  test("does not call Blob deletion when the failed upload has no stored file", async () => {
    const original = document({ blobUrl: undefined });
    const deps = dependencies({
      findDocument: vi.fn().mockResolvedValue(original),
      findDocumentsByBatch: vi.fn().mockResolvedValue([original]),
    });

    const response = await handleReplaceDocument(request(), documentId, deps);

    expect(response.status).toBe(200);
    expect(deps.deleteBlob).not.toHaveBeenCalled();
  });
});
