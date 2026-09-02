import type { PutBlobResult } from "@vercel/blob";
import { describe, expect, test, vi } from "vitest";

import { createAndUploadBatch, replaceAndUploadDocument } from "./client";

const batchId = "9f92701f-4866-45e6-b21f-1be3decc8d7d";
const clientIds = [
  "5f36e79a-30b9-4866-9157-524d7de72af3",
  "271bf840-1fed-443d-86fb-a82b0bd70465",
];
const documentIds = [
  "e267df76-9b0e-4616-b187-0252faf57880",
  "75f9d4bc-c530-43dd-a30f-91dad3ab8ff4",
];

function file(name: string): File {
  return new File(["document"], name, { type: "application/pdf" });
}

function blob(pathname: string): PutBlobResult {
  return {
    url: `https://private.example.invalid/${pathname}`,
    downloadUrl: `https://private.example.invalid/${pathname}?download=1`,
    pathname,
    contentType: "application/pdf",
    contentDisposition: "attachment",
    etag: "etag",
  };
}

function batchResponse() {
  return {
    batch: {
      id: batchId,
      status: "processing" as const,
      documents: [],
      createdAt: "2026-09-02T12:00:00.000Z",
      expiresAt: "2026-09-09T12:00:00.000Z",
    },
    files: clientIds.map((clientId, index) => ({
      clientId,
      documentId: documentIds[index],
      uploadPathname: `documents/${batchId}/${documentIds[index]}.pdf`,
    })),
  };
}

describe("client batch upload", () => {
  test("creates one batch and uploads every file through private presigned URLs", async () => {
    const fetchMock = vi.fn(
      async (...args: [RequestInfo | URL, RequestInit?]) => {
        void args;

        return Response.json(batchResponse(), { status: 201 });
      },
    );
    const upload = vi.fn(
      async (pathname: string, ...args: [File, object]) => {
        void args;

        return blob(pathname);
      },
    );
    const updates = vi.fn();
    const ids = [...clientIds];
    const result = await createAndUploadBatch(
      [file("one.pdf"), file("two.pdf")],
      updates,
      {
        createId: () => ids.shift()!,
        fetch: fetchMock as typeof fetch,
        upload,
      },
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    const [, request] = fetchMock.mock.calls[0];
    expect(JSON.parse(String(request?.body))).toEqual({
      files: [
        expect.objectContaining({ clientId: clientIds[0], filename: "one.pdf" }),
        expect.objectContaining({ clientId: clientIds[1], filename: "two.pdf" }),
      ],
    });
    expect(upload).toHaveBeenCalledTimes(2);
    expect(upload.mock.calls[0][2]).toMatchObject({
      access: "private",
      handleUploadUrl: "/api/upload",
      multipart: false,
    });
    expect(result.uploads.map((outcome) => outcome.status)).toEqual([
      "uploaded",
      "uploaded",
    ]);
  });

  test("isolates a failed file while the other upload succeeds", async () => {
    const fetchMock = vi.fn(
      async (...args: [RequestInfo | URL, RequestInit?]) => {
        void args;

        return Response.json(batchResponse(), { status: 201 });
      },
    );
    const upload = vi
      .fn<(pathname: string) => Promise<PutBlobResult>>()
      .mockRejectedValueOnce(new Error("network interrupted"))
      .mockImplementationOnce(async (pathname) => blob(pathname));
    const ids = [...clientIds];
    const result = await createAndUploadBatch(
      [file("one.pdf"), file("two.pdf")],
      vi.fn(),
      {
        createId: () => ids.shift()!,
        fetch: fetchMock as typeof fetch,
        upload,
      },
    );

    expect(result.uploads).toEqual([
      expect.objectContaining({
        status: "failed",
        error: "network interrupted",
      }),
      expect.objectContaining({ status: "uploaded" }),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({
      type: "docchat.upload-failed",
      payload: { batchId, documentId: documentIds[0] },
    });
  });

  test("rejects an invalid selection before creating the batch", async () => {
    const fetchMock = vi.fn();

    await expect(
      createAndUploadBatch([new File([], "empty.pdf")], vi.fn(), {
        createId: () => clientIds[0],
        fetch: fetchMock,
        upload: vi.fn(),
      }),
    ).rejects.toThrow("must pass validation");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("client replacement upload", () => {
  test("prepares and uploads a replacement through the existing upload route", async () => {
    const replacementFile = new File(["replacement"], "replacement.pdf", {
      type: "application/pdf",
    });
    const replacementDocument = {
      id: documentIds[0],
      batchId,
      filename: replacementFile.name,
      fileType: "pdf" as const,
      size: replacementFile.size,
      status: "queued" as const,
    };
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        document: replacementDocument,
        uploadPathname: `documents/${batchId}/${documentIds[0]}.pdf`,
      }),
    );
    const upload = vi.fn(async (pathname: string) => blob(pathname));
    const updates = vi.fn();

    await expect(
      replaceAndUploadDocument(
        documentIds[0],
        batchId,
        replacementFile,
        2,
        updates,
        {
          createId: () => clientIds[0],
          fetch: fetchMock,
          upload,
        },
      ),
    ).resolves.toEqual({
      document: replacementDocument,
      status: "uploaded",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/documents/${documentIds[0]}/replace`,
      expect.objectContaining({ method: "POST" }),
    );
    expect(upload).toHaveBeenCalledWith(
      `documents/${batchId}/${documentIds[0]}.pdf`,
      replacementFile,
      expect.objectContaining({
        handleUploadUrl: "/api/upload",
        clientPayload: JSON.stringify({
          batchId,
          documentId: documentIds[0],
        }),
      }),
    );
    expect(updates).toHaveBeenCalledWith({
      index: 2,
      status: "preparing-replacement",
    });
    expect(updates).toHaveBeenLastCalledWith({
      index: 2,
      status: "uploaded",
      progress: 100,
    });
  });

  test("reports an isolated replacement upload failure", async () => {
    const replacementFile = new File(["replacement"], "replacement.pdf", {
      type: "application/pdf",
    });
    const replacementDocument = {
      id: documentIds[0],
      batchId,
      filename: replacementFile.name,
      fileType: "pdf" as const,
      size: replacementFile.size,
      status: "queued" as const,
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          document: replacementDocument,
          uploadPathname: `documents/${batchId}/${documentIds[0]}.pdf`,
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    const result = await replaceAndUploadDocument(
      documentIds[0],
      batchId,
      replacementFile,
      0,
      vi.fn(),
      {
        createId: () => clientIds[0],
        fetch: fetchMock,
        upload: vi.fn().mockRejectedValue(new Error("network interrupted")),
      },
    );

    expect(result).toMatchObject({
      status: "failed",
      error: "network interrupted",
      document: {
        filename: "replacement.pdf",
        status: "failed",
        canRetry: false,
        error: { code: "UPLOAD_FAILED", message: "network interrupted" },
      },
    });
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({
      type: "docchat.upload-failed",
      payload: { batchId, documentId: documentIds[0] },
    });
  });
});
