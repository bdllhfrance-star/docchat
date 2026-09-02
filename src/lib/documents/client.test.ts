import { describe, expect, test, vi } from "vitest";

import { deleteDocument, retryDocument } from "./client";

const documentId = "e267df76-9b0e-4616-b187-0252faf57880";

describe("document actions client", () => {
  test("requests a retry and returns the server document state", async () => {
    const document = {
      id: documentId,
      batchId: "batch-1",
      filename: "guide.pdf",
      fileType: "pdf",
      size: 1024,
      status: "ready",
    } as const;
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ document }));

    await expect(retryDocument(documentId, fetchMock)).resolves.toEqual(
      document,
    );
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/documents/${documentId}/retry`,
      { method: "POST" },
    );
  });

  test("deletes a document through its REST endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(null, { status: 204 }),
    );

    await expect(deleteDocument(documentId, fetchMock)).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(`/api/documents/${documentId}`, {
      method: "DELETE",
    });
  });

  test("surfaces structured API errors", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json(
        {
          error: {
            code: "PROVIDER_ERROR",
            message: "The stored file could not be removed.",
            requestId: "request-123",
          },
        },
        { status: 502 },
      ),
    );

    await expect(deleteDocument(documentId, fetchMock)).rejects.toThrow(
      "The stored file could not be removed.",
    );
  });
});
