import {
  get as getBlob,
  type GetBlobResult,
  type GetCommandOptions,
} from "@vercel/blob";

import type { BlobEnv } from "@/lib/env";
import { getAllowedMimeTypes } from "@/lib/uploads/validation";
import type { DocumentRecord } from "@/types/persistence";

const blobDownloadTimeoutMilliseconds = 30_000;

export type BlobDownloadErrorCode =
  | "BLOB_DOWNLOAD_FAILED"
  | "BLOB_NOT_FOUND"
  | "BLOB_VALIDATION_FAILED";

export class BlobDownloadError extends Error {
  constructor(
    readonly code: BlobDownloadErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "BlobDownloadError";
  }
}

type BlobGetter = (
  pathname: string,
  options: GetCommandOptions,
) => Promise<GetBlobResult | null>;

export type DownloadPrivateDocumentOptions = {
  abortSignal?: AbortSignal;
  getBlob?: BlobGetter;
};

export async function downloadPrivateDocument(
  document: DocumentRecord,
  blob: BlobEnv,
  options: DownloadPrivateDocumentOptions = {},
): Promise<ArrayBuffer> {
  const timeoutSignal = AbortSignal.timeout(blobDownloadTimeoutMilliseconds);
  const signal = options.abortSignal
    ? AbortSignal.any([options.abortSignal, timeoutSignal])
    : timeoutSignal;

  try {
    const result = await (options.getBlob ?? getBlob)(document.blobPathname, {
      access: "private",
      useCache: false,
      oidcToken: blob.VERCEL_OIDC_TOKEN,
      storeId: blob.BLOB_STORE_ID,
      abortSignal: signal,
    });

    if (!result || result.statusCode !== 200) {
      throw new BlobDownloadError(
        "BLOB_NOT_FOUND",
        "The uploaded file could not be found.",
      );
    }

    if (
      result.blob.pathname !== document.blobPathname ||
      result.blob.size !== document.size ||
      !getAllowedMimeTypes(document.fileType).includes(result.blob.contentType)
    ) {
      throw new BlobDownloadError(
        "BLOB_VALIDATION_FAILED",
        "The uploaded file does not match its validated manifest.",
      );
    }

    const content = await new Response(result.stream).arrayBuffer();

    if (content.byteLength !== document.size) {
      throw new BlobDownloadError(
        "BLOB_VALIDATION_FAILED",
        "The downloaded file size does not match its validated manifest.",
      );
    }

    return content;
  } catch (error) {
    if (error instanceof BlobDownloadError) {
      throw error;
    }

    throw new BlobDownloadError(
      "BLOB_DOWNLOAD_FAILED",
      "The uploaded file could not be downloaded for processing.",
    );
  }
}
