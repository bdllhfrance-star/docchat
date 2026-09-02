import { describe, expect, test, vi } from "vitest";

import { getBatchStatus, pollBatchStatus } from "./client";
import type { BatchSummary } from "@/types/documents";

const processingBatch: BatchSummary = {
  id: "batch-1",
  status: "processing",
  documents: [
    {
      id: "document-1",
      batchId: "batch-1",
      filename: "guide.pdf",
      fileType: "pdf",
      size: 1024,
      status: "extracting",
    },
  ],
  createdAt: "2026-09-02T08:00:00.000Z",
  expiresAt: "2026-09-09T08:00:00.000Z",
};

function jsonResponse(batch: BatchSummary): Response {
  return Response.json({ batch });
}

describe("batch status client", () => {
  test("loads a batch without browser caching", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(processingBatch));

    await expect(getBatchStatus("batch-1", fetchMock)).resolves.toEqual(
      processingBatch,
    );
    expect(fetchMock).toHaveBeenCalledWith("/api/batches/batch-1", {
      cache: "no-store",
      signal: undefined,
    });
  });

  test("reports every real state and stops at a terminal batch", async () => {
    const readyBatch: BatchSummary = {
      ...processingBatch,
      status: "ready",
      documents: [{ ...processingBatch.documents[0], status: "ready" }],
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(processingBatch))
      .mockResolvedValueOnce(jsonResponse(readyBatch));
    const onUpdate = vi.fn();

    await expect(
      pollBatchStatus("batch-1", onUpdate, {
        fetch: fetchMock,
        intervalMs: 0,
        maxAttempts: 3,
      }),
    ).resolves.toEqual(readyBatch);
    expect(onUpdate).toHaveBeenNthCalledWith(1, processingBatch);
    expect(onUpdate).toHaveBeenNthCalledWith(2, readyBatch);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("stops after the configured number of attempts", async () => {
    const fetchMock = vi.fn().mockImplementation(async () =>
      jsonResponse(processingBatch),
    );

    await expect(
      pollBatchStatus("batch-1", vi.fn(), {
        fetch: fetchMock,
        intervalMs: 0,
        maxAttempts: 2,
      }),
    ).rejects.toThrow("taking longer than expected");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("surfaces API errors", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json(
        {
          error: {
            code: "NOT_FOUND",
            message: "Batch not found.",
            requestId: "request-123",
          },
        },
        { status: 404 },
      ),
    );

    await expect(getBatchStatus("batch-1", fetchMock)).rejects.toThrow(
      "Batch not found.",
    );
  });
});
