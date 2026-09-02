import type { ApiError, BatchStatusResponse } from "@/types/api";
import type { BatchSummary } from "@/types/documents";

const terminalBatchStatuses = new Set<BatchSummary["status"]>([
  "ready",
  "partial",
  "failed",
]);

type PollBatchOptions = {
  fetch?: typeof fetch;
  intervalMs?: number;
  maxAttempts?: number;
  signal?: AbortSignal;
};

function wait(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      return;
    }

    const handleAbort = () => {
      clearTimeout(timeout);
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    };
    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", handleAbort);
      resolve();
    }, milliseconds);
    signal?.addEventListener("abort", handleAbort, { once: true });
  });
}

export async function getBatchStatus(
  batchId: string,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<BatchSummary> {
  const response = await fetchImpl(`/api/batches/${batchId}`, {
    cache: "no-store",
    signal,
  });
  const body = (await response.json()) as BatchStatusResponse | ApiError;

  if (!response.ok) {
    throw new Error(
      "error" in body ? body.error.message : "The batch status could not be loaded.",
    );
  }

  if (!("batch" in body) || !Array.isArray(body.batch.documents)) {
    throw new Error("The batch status response is invalid.");
  }

  return body.batch;
}

export async function pollBatchStatus(
  batchId: string,
  onUpdate: (batch: BatchSummary) => void,
  options: PollBatchOptions = {},
): Promise<BatchSummary> {
  const {
    fetch: fetchImpl = fetch,
    intervalMs = 1_500,
    maxAttempts = 120,
    signal,
  } = options;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const batch = await getBatchStatus(batchId, fetchImpl, signal);
    onUpdate(batch);

    if (terminalBatchStatuses.has(batch.status)) {
      return batch;
    }

    if (attempt < maxAttempts - 1) {
      await wait(intervalMs, signal);
    }
  }

  throw new Error("Document processing is taking longer than expected.");
}
