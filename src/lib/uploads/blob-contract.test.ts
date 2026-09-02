import { describe, expect, test } from "vitest";

import {
  createBlobPathname,
  parseBlobCallbackPayload,
  parseBlobClientPayload,
  parseUploadFailureRequest,
} from "./blob-contract";

const batchId = "5f36e79a-30b9-4866-9157-524d7de72af3";
const documentId = "e267df76-9b0e-4616-b187-0252faf57880";
const sessionId = "271bf840-1fed-443d-86fb-a82b0bd70465";

describe("private Blob upload contract", () => {
  test("parses only the client-owned identifiers", () => {
    expect(
      parseBlobClientPayload(JSON.stringify({ batchId, documentId })),
    ).toEqual({ batchId, documentId });

    expect(() =>
      parseBlobClientPayload(
        JSON.stringify({ batchId, documentId, sessionId }),
      ),
    ).toThrow();
  });

  test("requires the signed callback session payload", () => {
    expect(
      parseBlobCallbackPayload(
        JSON.stringify({ batchId, documentId, sessionId }),
      ),
    ).toEqual({ batchId, documentId, sessionId });
    expect(() => parseBlobCallbackPayload(null)).toThrow();
  });

  test("creates a server-controlled pathname", () => {
    expect(createBlobPathname(batchId, documentId, "pdf")).toBe(
      `documents/${batchId}/${documentId}.pdf`,
    );
  });

  test("recognizes only the authenticated upload failure action", () => {
    expect(
      parseUploadFailureRequest({
        type: "docchat.upload-failed",
        payload: { batchId, documentId },
      }),
    ).toEqual({
      type: "docchat.upload-failed",
      payload: { batchId, documentId },
    });
    expect(
      parseUploadFailureRequest({
        type: "docchat.upload-failed",
        payload: { batchId, documentId, sessionId },
      }),
    ).toBeNull();
  });
});
