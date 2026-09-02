import { describe, expect, test, vi } from "vitest";

import type { CreatedBatch } from "@/types/persistence";

import { handleCreateBatch } from "./create-batch";

const clientId = "5f36e79a-30b9-4866-9157-524d7de72af3";
const sessionId = "271bf840-1fed-443d-86fb-a82b0bd70465";
const batchId = "9f92701f-4866-45e6-b21f-1be3decc8d7d";
const documentId = "e267df76-9b0e-4616-b187-0252faf57880";
const now = new Date("2026-09-02T12:00:00.000Z");

function request(body: unknown): Request {
  return new Request("http://localhost/api/batches", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

function dependencies() {
  const createBatch = vi.fn(async (created: CreatedBatch) => created);
  const ensureSession = vi.fn(async () => ({ sessionId, created: true }));
  const ids = [batchId, documentId];

  return {
    createBatch,
    ensureSession,
    createId: () => ids.shift()!,
    now: () => now,
    requestId: () => "request-123",
  };
}

describe("create batch handler", () => {
  test("creates queued documents owned by the signed session", async () => {
    const deps = dependencies();
    const response = await handleCreateBatch(
      request({
        files: [
          {
            clientId,
            filename: "guide.pdf",
            size: 1024,
            mimeType: "application/pdf",
          },
        ],
      }),
      deps,
    );

    expect(response.status).toBe(201);
    expect(deps.ensureSession).toHaveBeenCalledOnce();
    expect(deps.createBatch).toHaveBeenCalledWith({
      batch: expect.objectContaining({
        id: batchId,
        sessionId,
        status: "processing",
        totalFiles: 1,
      }),
      documents: [
        expect.objectContaining({
          id: documentId,
          batchId,
          blobPathname: `documents/${batchId}/${documentId}.pdf`,
          clientId,
          sessionId,
          status: "queued",
        }),
      ],
    });
    await expect(response.json()).resolves.toEqual({
      batch: expect.objectContaining({
        id: batchId,
        status: "processing",
        documents: [
          expect.objectContaining({
            id: documentId,
            status: "queued",
          }),
        ],
      }),
      files: [
        {
          clientId,
          documentId,
          uploadPathname: `documents/${batchId}/${documentId}.pdf`,
        },
      ],
    });
  });

  test("rejects client-controlled sessions before persistence", async () => {
    const deps = dependencies();
    const response = await handleCreateBatch(
      request({
        sessionId: "client-controlled",
        files: [
          {
            clientId,
            filename: "guide.pdf",
            size: 1024,
            mimeType: "application/pdf",
          },
        ],
      }),
      deps,
    );

    expect(response.status).toBe(400);
    expect(deps.ensureSession).not.toHaveBeenCalled();
    expect(deps.createBatch).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "INVALID_REQUEST",
        requestId: "request-123",
      },
    });
  });

  test("maps size and format failures to the shared API error", async () => {
    const oversized = dependencies();
    const sizeResponse = await handleCreateBatch(
      request({
        files: [
          {
            clientId,
            filename: "guide.pdf",
            size: 11 * 1024 * 1024,
            mimeType: "application/pdf",
          },
        ],
      }),
      oversized,
    );

    expect(sizeResponse.status).toBe(413);
    await expect(sizeResponse.json()).resolves.toMatchObject({
      error: { code: "PAYLOAD_TOO_LARGE" },
    });

    const unsupported = dependencies();
    const formatResponse = await handleCreateBatch(
      request({
        files: [
          {
            clientId,
            filename: "legacy.doc",
            size: 1024,
            mimeType: "application/msword",
          },
        ],
      }),
      unsupported,
    );

    expect(formatResponse.status).toBe(415);
    await expect(formatResponse.json()).resolves.toMatchObject({
      error: { code: "UNSUPPORTED_FILE_TYPE" },
    });
  });

  test("does not expose persistence errors", async () => {
    const deps = dependencies();
    deps.createBatch.mockRejectedValueOnce(
      new Error("mongodb://user:secret@example.invalid"),
    );
    const response = await handleCreateBatch(
      request({
        files: [
          {
            clientId,
            filename: "guide.pdf",
            size: 1024,
            mimeType: "application/pdf",
          },
        ],
      }),
      deps,
    );
    const body = await response.text();

    expect(response.status).toBe(500);
    expect(body).not.toContain("mongodb://");
    expect(body).not.toContain("secret");
  });
});
