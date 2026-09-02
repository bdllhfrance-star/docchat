import { z } from "zod";

import type {
  BlobUploadClientPayload,
  ReportUploadFailureRequest,
  ValidatedBatchManifestFile,
} from "@/types/api";

const serializedPayloadMaxLength = 512;

const clientPayloadSchema = z
  .object({
    batchId: z.string().uuid(),
    documentId: z.string().uuid(),
  })
  .strict();

const callbackPayloadSchema = clientPayloadSchema.extend({
  sessionId: z.string().uuid(),
});

const uploadFailureRequestSchema = z
  .object({
    type: z.literal("docchat.upload-failed"),
    payload: clientPayloadSchema,
  })
  .strict();

export type BlobUploadCallbackPayload = BlobUploadClientPayload & {
  sessionId: string;
};

function parseSerializedPayload(payload: string | null): unknown {
  if (!payload || payload.length > serializedPayloadMaxLength) {
    throw new Error("Invalid Blob upload payload");
  }

  try {
    return JSON.parse(payload);
  } catch {
    throw new Error("Invalid Blob upload payload");
  }
}

export function parseBlobClientPayload(
  payload: string | null,
): BlobUploadClientPayload {
  return clientPayloadSchema.parse(parseSerializedPayload(payload));
}

export function parseBlobCallbackPayload(
  payload: string | null | undefined,
): BlobUploadCallbackPayload {
  return callbackPayloadSchema.parse(parseSerializedPayload(payload ?? null));
}

export function parseUploadFailureRequest(
  input: unknown,
): ReportUploadFailureRequest | null {
  const result = uploadFailureRequestSchema.safeParse(input);

  return result.success ? result.data : null;
}

export function createBlobPathname(
  batchId: string,
  documentId: string,
  fileType: ValidatedBatchManifestFile["fileType"],
): string {
  return `documents/${batchId}/${documentId}.${fileType}`;
}
