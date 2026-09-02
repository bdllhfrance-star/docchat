import { describe, expect, test, vi } from "vitest";

import { handleGetBatch, type GetBatchDependencies } from "./get-batch";

const batchId = "5f36e79a-30b9-4866-9157-524d7de72af3";
const sessionId = "271bf840-1fed-443d-86fb-a82b0bd70465";
const createdAt = new Date("2026-09-02T08:00:00.000Z");
const expiresAt = new Date("2026-09-09T08:00:00.000Z");

function dependencies(
  overrides: Partial<GetBatchDependencies> = {},
): GetBatchDependencies {
  return {
    requireSession: vi.fn().mockResolvedValue(sessionId),
    findBatchBySession: vi.fn().mockResolvedValue({
      id: batchId,
      sessionId,
      status: "processing",
      totalFiles: 1,
      readyFiles: 0,
      failedFiles: 0,
      createdAt,
      expiresAt,
    }),
    findDocumentsByBatch: vi.fn().mockResolvedValue([
      {
        id: "e267df76-9b0e-4616-b187-0252faf57880",
        clientId: "69645762-69de-4f03-a2c1-b6f07a94f5b7",
        batchId,
        sessionId,
        filename: "guide.pdf",
        mimeType: "application/pdf",
        fileType: "pdf",
        blobPathname: "documents/private.pdf",
        blobUrl: "https://blob.example/private.pdf",
        size: 1024,
        status: "extracting",
        createdAt,
        expiresAt,
      },
    ]),
    requestId: () => "request-123",
    ...overrides,
  };
}

describe("get batch API", () => {
  test("returns session-owned processing states without private storage data", async () => {
    const response = await handleGetBatch(batchId, dependencies());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      batch: {
        id: batchId,
        status: "processing",
        documents: [
          {
            id: "e267df76-9b0e-4616-b187-0252faf57880",
            batchId,
            filename: "guide.pdf",
            fileType: "pdf",
            size: 1024,
            status: "extracting",
            canRetry: false,
          },
        ],
        createdAt: createdAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
      },
    });
    expect(JSON.stringify(body)).not.toContain("blob");
    expect(JSON.stringify(body)).not.toContain(sessionId);
  });

  test("rejects a missing session before reading the batch", async () => {
    const deps = dependencies({
      requireSession: vi.fn().mockResolvedValue(null),
    });
    const response = await handleGetBatch(batchId, deps);

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      error: { code: "UNAUTHORIZED_SESSION" },
    });
    expect(deps.findBatchBySession).not.toHaveBeenCalled();
  });

  test("does not expose a batch outside the current session", async () => {
    const response = await handleGetBatch(
      batchId,
      dependencies({ findBatchBySession: vi.fn().mockResolvedValue(null) }),
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      error: { code: "NOT_FOUND" },
    });
  });

  test("rejects an invalid batch identifier without database access", async () => {
    const deps = dependencies();
    const response = await handleGetBatch("not-a-uuid", deps);

    expect(response.status).toBe(400);
    expect(deps.requireSession).not.toHaveBeenCalled();
    expect(deps.findBatchBySession).not.toHaveBeenCalled();
  });
});
