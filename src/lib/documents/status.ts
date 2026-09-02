import type { DocumentStatus } from "@/types/documents";

const allowedTransitions = {
  queued: ["uploading", "failed"],
  uploading: ["validating", "failed"],
  validating: ["extracting", "failed"],
  extracting: ["chunking", "failed"],
  chunking: ["embedding", "failed"],
  embedding: ["indexing", "failed"],
  indexing: ["ready", "failed"],
  ready: [],
  failed: ["uploading", "validating"],
} as const satisfies Record<DocumentStatus, readonly DocumentStatus[]>;

export function canTransitionDocumentStatus(
  from: DocumentStatus,
  to: DocumentStatus,
): boolean {
  return allowedTransitions[from].some((status) => status === to);
}

export function isProcessingDocumentStatus(status: DocumentStatus): boolean {
  return status !== "ready" && status !== "failed";
}

export function canSendMessage(statuses: readonly DocumentStatus[]): boolean {
  return statuses.length > 0 && statuses.every((status) => status === "ready");
}
