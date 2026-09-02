// @vitest-environment node

import type { GetBlobResult } from "@vercel/blob";
import { describe, expect, test, vi } from "vitest";

import type { BlobEnv } from "@/lib/env";
import type { DocumentRecord } from "@/types/persistence";

import { downloadPrivateDocument } from "./blob-storage";

const content = new TextEncoder().encode("%PDF-test");
const document: DocumentRecord = {
  id: "e267df76-9b0e-4616-b187-0252faf57880",
  clientId: "5f36e79a-30b9-4866-9157-524d7de72af3",
  batchId: "9f92701f-4866-45e6-b21f-1be3decc8d7d",
  sessionId: "271bf840-1fed-443d-86fb-a82b0bd70465",
  filename: "guide.pdf",
  mimeType: "application/pdf",
  fileType: "pdf",
  blobPathname:
    "documents/9f92701f-4866-45e6-b21f-1be3decc8d7d/e267df76-9b0e-4616-b187-0252faf57880.pdf",
  blobUrl: "https://blob.example/guide.pdf",
  size: content.byteLength,
  status: "validating",
  createdAt: new Date("2026-09-02T12:00:00.000Z"),
  expiresAt: new Date("2026-09-09T12:00:00.000Z"),
};
const blob: BlobEnv = {
  BLOB_STORE_ID: "store-id",
  VERCEL_OIDC_TOKEN: "oidc-token",
  BLOB_WEBHOOK_PUBLIC_KEY: "public-key",
};

type SuccessfulBlob = Extract<GetBlobResult, { statusCode: 200 }>["blob"];

function blobResult(overrides: Partial<SuccessfulBlob> = {}): GetBlobResult {
  return {
    statusCode: 200,
    stream: new ReadableStream({
      start(controller) {
        controller.enqueue(content);
        controller.close();
      },
    }),
    headers: new Headers(),
    blob: {
      url: document.blobUrl!,
      downloadUrl: `${document.blobUrl}?download=1`,
      pathname: document.blobPathname,
      contentDisposition: "attachment",
      cacheControl: "public, max-age=0",
      uploadedAt: document.createdAt,
      etag: "etag",
      contentType: "application/pdf",
      size: content.byteLength,
      ...overrides,
    },
  };
}

describe("private document download", () => {
  test("downloads the exact private Blob from the configured store", async () => {
    const getBlob = vi.fn(async () => blobResult());

    const result = await downloadPrivateDocument(document, blob, { getBlob });

    expect(new Uint8Array(result)).toEqual(content);
    expect(getBlob).toHaveBeenCalledWith(
      document.blobPathname,
      expect.objectContaining({
        access: "private",
        useCache: false,
        oidcToken: "oidc-token",
        storeId: "store-id",
      }),
    );
  });

  test("rejects a missing Blob", async () => {
    await expect(
      downloadPrivateDocument(document, blob, {
        getBlob: async () => null,
      }),
    ).rejects.toMatchObject({ code: "BLOB_NOT_FOUND" });
  });

  test("rejects content that differs from the manifest", async () => {
    await expect(
      downloadPrivateDocument(document, blob, {
        getBlob: async () => blobResult({ size: content.byteLength + 1 }),
      }),
    ).rejects.toMatchObject({ code: "BLOB_VALIDATION_FAILED" });
  });
});
