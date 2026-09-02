import type { PutBlobResult, UploadProgressEvent } from "@vercel/blob";
import { upload } from "@vercel/blob/client";

import { validateBatchFiles } from "@/lib/uploads/validation";
import type {
  AddBatchDocumentsResponse,
  ApiError,
  CreateBatchResponse,
  ReplaceDocumentResponse,
} from "@/types/api";
import type { DocumentSummary } from "@/types/documents";

const uploadConcurrency = 3;

export type ClientUploadStatus =
  | "creating-batch"
  | "preparing-update"
  | "preparing-replacement"
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

export type ClientReplacementUploadResult = {
  document: DocumentSummary;
  status: "uploaded" | "failed";
  error?: string;
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
  upload: (...args) => upload(...args),
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Upload failed.";
}

async function readBatchResponse(
  response: Response,
): Promise<CreateBatchResponse | AddBatchDocumentsResponse> {
  const body = (await response.json()) as
    | CreateBatchResponse
    | AddBatchDocumentsResponse
    | ApiError;

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

async function readReplacementResponse(
  response: Response,
  documentId: string,
): Promise<ReplaceDocumentResponse> {
  const body = (await response.json()) as ReplaceDocumentResponse | ApiError;

  if (!response.ok) {
    if ("error" in body) {
      throw new Error(body.error.message);
    }

    throw new Error("The document could not be replaced.");
  }

  if (
    !("document" in body) ||
    !body.uploadPathname ||
    body.document.id !== documentId
  ) {
    throw new Error("The replacement response is invalid.");
  }

  return body;
}

type ClientUploadTarget = {
  batchId: string;
  documentId: string;
  uploadPathname: string;
};

async function uploadDocumentFile(
  target: ClientUploadTarget,
  file: File,
  onProgress: (percentage: number) => void,
  dependencies: ClientUploadDependencies,
): Promise<void> {
  await dependencies.upload(target.uploadPathname, file, {
    access: "private",
    handleUploadUrl: "/api/upload",
    clientPayload: JSON.stringify({
      batchId: target.batchId,
      documentId: target.documentId,
    }),
    ...(file.type ? { contentType: file.type } : {}),
    multipart: false,
    onUploadProgress: ({ percentage }) => onProgress(percentage),
  });
}

async function reportUploadFailure(
  target: Pick<ClientUploadTarget, "batchId" | "documentId">,
  dependencies: ClientUploadDependencies,
): Promise<void> {
  try {
    await dependencies.fetch("/api/upload", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "docchat.upload-failed",
        payload: {
          batchId: target.batchId,
          documentId: target.documentId,
        },
      }),
    });
  } catch {
    // The original upload error remains the actionable client result.
  }
}

type PreparedUpload = {
  clientId: string;
  file: File;
  index: number;
};

async function uploadPreparedFiles(
  created: CreateBatchResponse | AddBatchDocumentsResponse,
  prepared: readonly PreparedUpload[],
  onUpdate: (update: ClientUploadUpdate) => void,
  dependencies: ClientUploadDependencies,
): Promise<ClientUploadOutcome[]> {
  const serverFiles = new Map(
    created.files.map((file) => [file.clientId, file]),
  );
  const outcomes: ClientUploadOutcome[] = [];
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < prepared.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      const current = prepared[currentIndex];
      const serverFile = serverFiles.get(current.clientId);

      if (!serverFile) {
        const error = "The server did not return an upload target.";
        outcomes.push({
          index: current.index,
          documentId: "",
          status: "failed",
          error,
        });
        onUpdate({ index: current.index, status: "failed", error });
        continue;
      }

      onUpdate({ index: current.index, status: "uploading", progress: 0 });

      try {
        await uploadDocumentFile(
          {
            batchId: created.batch.id,
            documentId: serverFile.documentId,
            uploadPathname: serverFile.uploadPathname,
          },
          current.file,
          (percentage) =>
            onUpdate({
              index: current.index,
              status: "uploading",
              progress: percentage,
            }),
          dependencies,
        );

        outcomes.push({
          index: current.index,
          documentId: serverFile.documentId,
          status: "uploaded",
        });
        onUpdate({ index: current.index, status: "uploaded", progress: 100 });
      } catch (error) {
        const message = errorMessage(error);
        await reportUploadFailure(
          { batchId: created.batch.id, documentId: serverFile.documentId },
          dependencies,
        );

        outcomes.push({
          index: current.index,
          documentId: serverFile.documentId,
          status: "failed",
          error: message,
        });
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

  return outcomes.sort((left, right) => left.index - right.index);
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
  const outcomes = await uploadPreparedFiles(
    created,
    prepared,
    onUpdate,
    dependencies,
  );

  return { batch: created.batch, uploads: outcomes };
}

export async function addAndUploadDocuments(
  batchId: string,
  additions: readonly { file: File; index: number }[],
  onUpdate: (update: ClientUploadUpdate) => void,
  dependencies: ClientUploadDependencies = defaultDependencies,
): Promise<ClientBatchUploadResult> {
  if (additions.length === 0) {
    throw new Error("Select at least one new document.");
  }

  const validation = validateBatchFiles(additions.map(({ file }) => file));

  if (!validation.isValid) {
    throw new Error("The new files must pass validation before upload.");
  }

  const prepared = additions.map(({ file, index }) => ({
    clientId: dependencies.createId(),
    file,
    index,
  }));

  prepared.forEach(({ index }) =>
    onUpdate({ index, status: "preparing-update" }),
  );

  const response = await dependencies.fetch(
    `/api/batches/${batchId}/documents`,
    {
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
    },
  );
  const updated = await readBatchResponse(response);
  const uploads = await uploadPreparedFiles(
    updated,
    prepared,
    onUpdate,
    dependencies,
  );

  return { batch: updated.batch, uploads };
}

export async function replaceAndUploadDocument(
  documentId: string,
  batchId: string,
  file: File,
  index: number,
  onUpdate: (update: ClientUploadUpdate) => void,
  dependencies: ClientUploadDependencies = defaultDependencies,
): Promise<ClientReplacementUploadResult> {
  if (!validateBatchFiles([file]).isValid) {
    throw new Error("The replacement file must pass validation before upload.");
  }

  onUpdate({ index, status: "preparing-replacement" });
  const response = await dependencies.fetch(
    `/api/documents/${documentId}/replace`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        clientId: dependencies.createId(),
        filename: file.name,
        size: file.size,
        mimeType: file.type,
      }),
    },
  );
  const replacement = await readReplacementResponse(response, documentId);
  const target = {
    batchId,
    documentId,
    uploadPathname: replacement.uploadPathname,
  };

  onUpdate({ index, status: "uploading", progress: 0 });

  try {
    await uploadDocumentFile(
      target,
      file,
      (percentage) =>
        onUpdate({ index, status: "uploading", progress: percentage }),
      dependencies,
    );
    onUpdate({ index, status: "uploaded", progress: 100 });

    return { document: replacement.document, status: "uploaded" };
  } catch (error) {
    const message = errorMessage(error);
    await reportUploadFailure(target, dependencies);
    onUpdate({ index, status: "failed", error: message });

    return {
      document: {
        ...replacement.document,
        status: "failed",
        canRetry: false,
        error: { code: "UPLOAD_FAILED", message },
      },
      status: "failed",
      error: message,
    };
  }
}
