import type { PutBlobResult, UploadProgressEvent } from "@vercel/blob";
import { uploadPresigned } from "@vercel/blob/client";

import { validateBatchFiles } from "@/lib/uploads/validation";
import type { ApiError, CreateBatchResponse } from "@/types/api";

const uploadConcurrency = 3;

export type ClientUploadStatus =
  | "creating-batch"
  | "uploading"
  | "uploaded"
  | "failed";

export type ClientUploadUpdate = {
  index: number;
  status: ClientUploadStatus;
  progress?: number;
  error?: string;
};

export type ClientUploadOutcome = {
  index: number;
  documentId: string;
  status: "uploaded" | "failed";
  error?: string;
};

export type ClientBatchUploadResult = {
  batch: CreateBatchResponse["batch"];
  uploads: ClientUploadOutcome[];
};

type ClientUploadDependencies = {
  createId: () => string;
  fetch: typeof fetch;
  upload: (
    pathname: string,
    file: File,
    options: {
      access: "private";
      handleUploadUrl: string;
      clientPayload: string;
      contentType?: string;
      multipart: false;
      onUploadProgress: (event: UploadProgressEvent) => void;
    },
  ) => Promise<PutBlobResult>;
};

const defaultDependencies: ClientUploadDependencies = {
  createId: () => crypto.randomUUID(),
  fetch: (...args) => fetch(...args),
  upload: (...args) => uploadPresigned(...args),
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Upload failed.";
}

async function readBatchResponse(response: Response): Promise<CreateBatchResponse> {
  const body = (await response.json()) as CreateBatchResponse | ApiError;

  if (!response.ok) {
    if ("error" in body) {
      throw new Error(body.error.message);
    }

    throw new Error("The batch could not be created.");
  }

  if (!("batch" in body) || !("files" in body)) {
    throw new Error("The batch response is invalid.");
  }

  return body;
}

export async function createAndUploadBatch(
  files: readonly File[],
  onUpdate: (update: ClientUploadUpdate) => void,
  dependencies: ClientUploadDependencies = defaultDependencies,
): Promise<ClientBatchUploadResult> {
  const validation = validateBatchFiles(files);

  if (!validation.isValid) {
    throw new Error("The selected files must pass validation before upload.");
  }

  const prepared = files.map((file, index) => ({
    clientId: dependencies.createId(),
    file,
    index,
  }));

  prepared.forEach(({ index }) =>
    onUpdate({ index, status: "creating-batch" }),
  );

  const batchResponse = await dependencies.fetch("/api/batches", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      files: prepared.map(({ clientId, file }) => ({
        clientId,
        filename: file.name,
        size: file.size,
        mimeType: file.type,
      })),
    }),
  });
  const created = await readBatchResponse(batchResponse);
  const serverFiles = new Map(
    created.files.map((file) => [file.clientId, file]),
  );
  const outcomes: ClientUploadOutcome[] = new Array(prepared.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < prepared.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      const current = prepared[currentIndex];
      const serverFile = serverFiles.get(current.clientId);

      if (!serverFile) {
        const error = "The server did not return an upload target.";
        outcomes[current.index] = {
          index: current.index,
          documentId: "",
          status: "failed",
          error,
        };
        onUpdate({ index: current.index, status: "failed", error });
        continue;
      }

      onUpdate({ index: current.index, status: "uploading", progress: 0 });

      try {
        await dependencies.upload(serverFile.uploadPathname, current.file, {
          access: "private",
          handleUploadUrl: "/api/upload",
          clientPayload: JSON.stringify({
            batchId: created.batch.id,
            documentId: serverFile.documentId,
          }),
          ...(current.file.type ? { contentType: current.file.type } : {}),
          multipart: false,
          onUploadProgress: ({ percentage }) =>
            onUpdate({
              index: current.index,
              status: "uploading",
              progress: percentage,
            }),
        });

        outcomes[current.index] = {
          index: current.index,
          documentId: serverFile.documentId,
          status: "uploaded",
        };
        onUpdate({ index: current.index, status: "uploaded", progress: 100 });
      } catch (error) {
        const message = errorMessage(error);

        try {
          await dependencies.fetch("/api/upload", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              type: "docchat.upload-failed",
              payload: {
                batchId: created.batch.id,
                documentId: serverFile.documentId,
              },
            }),
          });
        } catch {
          // The original upload error remains the actionable client result.
        }

        outcomes[current.index] = {
          index: current.index,
          documentId: serverFile.documentId,
          status: "failed",
          error: message,
        };
        onUpdate({ index: current.index, status: "failed", error: message });
      }
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(uploadConcurrency, prepared.length) },
      () => worker(),
    ),
  );

  return { batch: created.batch, uploads: outcomes };
}
