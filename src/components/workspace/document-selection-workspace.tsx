"use client";

import {
  ArrowUp,
  CheckCircle2,
  CircleEllipsis,
  Clock3,
  Files,
  LockKeyhole,
  MessageSquareText,
  Plus,
  RotateCcw,
  Trash2,
  Upload,
} from "lucide-react";
import {
  type ChangeEvent,
  type DragEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { pollBatchStatus } from "@/lib/batches/client";
import {
  deleteDocument,
  retryDocument,
} from "@/lib/documents/client";
import {
  addAndUploadDocuments,
  createAndUploadBatch,
  type ClientUploadUpdate,
} from "@/lib/uploads/client";
import {
  validateBatchFiles,
  type BatchValidationErrorCode,
  type FileValidationErrorCode,
} from "@/lib/uploads/validation";
import type {
  BatchSummary,
  DocumentStatus,
  DocumentSummary,
} from "@/types/documents";

import { ChatWorkspace } from "./chat-workspace";
import {
  DocumentOperationIcon,
  type DocumentOperationState,
} from "./document-operation-icon";

const acceptedFileTypes = ".pdf,.docx,.pptx,.xlsx,.txt,.md,.csv";
const supportedFormats = "PDF, DOCX, PPTX, XLSX, TXT, MD and CSV";

const fileErrorMessages: Record<FileValidationErrorCode, string> = {
  EMPTY_FILE: "This file is empty.",
  FILE_TOO_LARGE: "This file exceeds the 10 MiB limit.",
  MIME_TYPE_MISMATCH: "The file content type does not match its extension.",
  UNSAFE_FILENAME: "This file name contains unsupported characters.",
  UNSUPPORTED_FILE_TYPE: "This file format is not supported.",
};

const batchErrorMessages: Record<BatchValidationErrorCode, string> = {
  BATCH_TOO_LARGE: "The selection exceeds the 50 MiB batch limit.",
  TOO_MANY_FILES: "Select no more than 10 files in one batch.",
};

function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KiB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function getBatchStatusFromDocuments(
  documents: readonly DocumentSummary[],
): BatchSummary["status"] {
  if (
    documents.some(
      (document) =>
        document.status !== "ready" && document.status !== "failed",
    )
  ) {
    return "processing";
  }

  const readyFiles = documents.filter(
    (document) => document.status === "ready",
  ).length;

  if (readyFiles === documents.length) {
    return "ready";
  }

  return readyFiles > 0 ? "partial" : "failed";
}

function removeIndexedValue<T>(
  values: Partial<Record<number, T>>,
  removedIndex: number,
): Partial<Record<number, T>> {
  const next: Partial<Record<number, T>> = {};

  for (const [rawIndex, value] of Object.entries(values)) {
    const index = Number(rawIndex);

    if (value !== undefined && index !== removedIndex) {
      next[index > removedIndex ? index - 1 : index] = value;
    }
  }

  return next;
}

type SelectionResult = ReturnType<typeof validateBatchFiles<File>>;
type UploadUpdates = Partial<Record<number, ClientUploadUpdate>>;
type ProcessingDocuments = Partial<Record<number, DocumentSummary>>;
type DocumentAction = "deleting" | "retrying";
type DocumentActions = Partial<Record<string, DocumentAction>>;
type DocumentActionErrors = Partial<Record<string, string>>;

function getDocumentOperationState(input: {
  action?: DocumentAction;
  hasLocalError: boolean;
  processingDocument?: DocumentSummary;
  uploadUpdate?: ClientUploadUpdate;
}): DocumentOperationState {
  if (input.action) {
    return input.action;
  }

  if (
    input.hasLocalError ||
    input.uploadUpdate?.status === "failed" ||
    input.processingDocument?.status === "failed"
  ) {
    return "failed";
  }

  if (input.uploadUpdate?.status === "uploading") {
    return "upload-transfer";
  }

  if (input.processingDocument) {
    return input.processingDocument.status;
  }

  if (input.uploadUpdate?.status === "preparing-replacement") {
    return "replacing";
  }

  if (input.uploadUpdate) {
    return "queued";
  }

  return "selected";
}

type DocumentsPanelProps = {
  isSelectionLocked: boolean;
  actionErrors: DocumentActionErrors;
  actions: DocumentActions;
  canAddFromSidebar: boolean;
  canSubmitChanges: boolean;
  creationError: string | null;
  hasContext: boolean;
  isUploading: boolean;
  onDelete: (index: number, document: DocumentSummary) => void;
  onOpenPicker: () => void;
  onRemove: (index: number) => void;
  onRetry: (document: DocumentSummary) => void;
  onSubmitChanges: () => void;
  onToggleChatDocument: (documentId: string) => void;
  pendingFileCount: number;
  processingDocuments: ProcessingDocuments;
  result: SelectionResult;
  selectedChatDocumentIds: readonly string[];
  uploadUpdates: UploadUpdates;
};

function UploadState({ update }: { update: ClientUploadUpdate }) {
  if (
    update.status === "creating-batch" ||
    update.status === "preparing-update" ||
    update.status === "preparing-replacement"
  ) {
    return (
      <p
        className="mt-2 flex items-center gap-1.5 border-t border-slate-100 pt-2 text-xs text-slate-600"
        role="status"
        aria-live="polite"
      >
        <CircleEllipsis size={13} aria-hidden="true" />
        {update.status === "creating-batch"
          ? "Creating batch"
          : update.status === "preparing-update"
            ? "Preparing context update"
            : "Preparing replacement"}
      </p>
    );
  }

  if (update.status === "uploading") {
    const progress = Math.round(
      Math.min(100, Math.max(0, update.progress ?? 0)),
    );

    return (
      <div className="mt-2 border-t border-slate-100 pt-2">
        <div className="flex items-center justify-between gap-3 text-xs text-slate-600">
          <span>Uploading</span>
          <span className="font-medium tabular-nums">{progress}%</span>
        </div>
        <div
          className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100"
          role="progressbar"
          aria-label={`Uploading ${progress}%`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress}
        >
          <div
            className="h-full rounded-full bg-slate-700"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
    );
  }

  if (update.status === "uploaded") {
    return (
      <p
        className="mt-2 flex items-center gap-1.5 border-t border-slate-100 pt-2 text-xs text-blue-800"
        role="status"
        aria-live="polite"
      >
        <Clock3 size={13} aria-hidden="true" />
        Uploaded · waiting for processing
      </p>
    );
  }

  return (
    <div
      className="mt-2 border-t border-red-100 pt-2 text-xs leading-5 text-red-700"
      role="alert"
    >
      <p className="font-medium">Upload failed</p>
      <p>{update.error ?? "The file could not be uploaded."}</p>
    </div>
  );
}

const processingLabels: Record<DocumentStatus, string> = {
  queued: "Queued for processing",
  uploading: "Confirming upload",
  validating: "Validating file",
  extracting: "Extracting text",
  chunking: "Creating chunks",
  embedding: "Generating embeddings",
  indexing: "Saving search index",
  ready: "Ready",
  failed: "Processing failed",
};

type ProcessingStateProps = {
  action?: DocumentAction;
  actionError?: string;
  actionsDisabled: boolean;
  document: DocumentSummary;
  onDelete: () => void;
  onRetry: () => void;
  onToggleChatDocument: () => void;
  selectedForChat: boolean;
  selectedForChatCount: number;
};

function ProcessingState({
  action,
  actionError,
  actionsDisabled,
  document,
  onDelete,
  onRetry,
  onToggleChatDocument,
  selectedForChat,
  selectedForChatCount,
}: ProcessingStateProps) {
  if (document.status === "ready") {
    return (
      <div className="mt-2 border-t border-emerald-100 pt-2">
        <div className="flex items-center justify-between gap-3">
          <p
            className="flex items-center gap-1.5 text-xs font-medium text-emerald-700"
            role="status"
            aria-live="polite"
          >
            <CheckCircle2 size={13} aria-hidden="true" />
            Ready
          </p>
          <div className="flex items-center gap-1">
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 has-disabled:cursor-not-allowed has-disabled:opacity-50">
              <input
                type="checkbox"
                checked={selectedForChat}
                onChange={onToggleChatDocument}
                disabled={selectedForChat && selectedForChatCount === 1}
                className="size-3.5 accent-slate-900"
                aria-label={`Use ${document.filename} in chat`}
              />
              Use in chat
            </label>
            <button
              type="button"
              onClick={onDelete}
              disabled={actionsDisabled}
              className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100 hover:text-red-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-950 disabled:cursor-wait disabled:opacity-50"
              aria-label={`Delete ${document.filename}`}
            >
              {action === "deleting" ? (
                <Trash2 className="document-delete-once" size={13} aria-hidden="true" />
              ) : (
                <Trash2 size={13} aria-hidden="true" />
              )}
              {action === "deleting" ? "Deleting" : "Delete"}
            </button>
          </div>
        </div>
        {actionError ? (
          <p className="mt-2 text-xs leading-5 text-red-700" role="alert">
            {actionError}
          </p>
        ) : null}
      </div>
    );
  }

  if (document.status === "failed") {
    return (
      <div
        className="mt-2 border-t border-red-100 pt-2 text-xs leading-5 text-red-700"
        role="alert"
      >
        <p className="font-medium">Processing failed</p>
        <p>{document.error?.message ?? "The document could not be processed."}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {document.canRetry ? (
            <button
              type="button"
              onClick={onRetry}
              disabled={actionsDisabled}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-950 disabled:cursor-wait disabled:opacity-50"
              aria-label={`Retry ${document.filename}`}
            >
              {action === "retrying" ? (
                <RotateCcw className="document-retry-once" size={13} aria-hidden="true" />
              ) : (
                <RotateCcw size={13} aria-hidden="true" />
              )}
              {action === "retrying" ? "Retrying" : "Retry"}
            </button>
          ) : null}
          <button
            type="button"
            onClick={onDelete}
            disabled={actionsDisabled}
            className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-2.5 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700 disabled:cursor-wait disabled:opacity-50"
            aria-label={`Delete ${document.filename}`}
          >
            {action === "deleting" ? (
              <Trash2 className="document-delete-once" size={13} aria-hidden="true" />
            ) : (
              <Trash2 size={13} aria-hidden="true" />
            )}
            {action === "deleting" ? "Deleting" : "Delete"}
          </button>
        </div>
        {actionError ? (
          <p className="mt-2 text-xs leading-5 text-red-700" role="alert">
            {actionError}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <p
      className="mt-2 flex items-center gap-1.5 border-t border-slate-100 pt-2 text-xs text-blue-800"
      role="status"
      aria-live="polite"
    >
      <span
        className="document-stage-pulse size-1.5 rounded-full bg-blue-600"
        aria-hidden="true"
      />
      {processingLabels[document.status]}
    </p>
  );
}

function DocumentsPanel({
  actionErrors,
  actions,
  canAddFromSidebar,
  canSubmitChanges,
  creationError,
  hasContext,
  isSelectionLocked,
  isUploading,
  onDelete,
  onOpenPicker,
  onRemove,
  onRetry,
  onSubmitChanges,
  onToggleChatDocument,
  pendingFileCount,
  processingDocuments,
  result,
  selectedChatDocumentIds,
  uploadUpdates,
}: DocumentsPanelProps) {
  const hasFiles = result.files.length > 0;
  const actionsDisabled = Object.keys(actions).length > 0;
  const selectedChatDocumentIdSet = new Set(selectedChatDocumentIds);

  return (
    <aside
      className="min-w-0 border-b border-slate-200 bg-slate-50/70 lg:flex lg:min-h-0 lg:flex-col lg:overflow-hidden lg:border-r lg:border-b-0"
      aria-labelledby="documents-heading"
    >
      <div className="flex shrink-0 items-center justify-between px-4 py-4 sm:px-5 lg:py-5">
        <div className="flex items-center gap-2.5">
          <Files size={17} className="text-slate-500" aria-hidden="true" />
          <h2
            id="documents-heading"
            className="text-sm font-semibold text-slate-900"
          >
            Documents
          </h2>
        </div>
        <span
          className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-xs font-medium tabular-nums text-slate-500"
          aria-label={`${result.files.length} documents`}
        >
          {result.files.length}
        </span>
      </div>

      {result.errors.length > 0 ? (
        <div
          className="mx-4 mb-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-xs leading-5 text-red-800 sm:mx-5"
          role="alert"
        >
          {result.errors.map((error) => (
            <p key={error}>{batchErrorMessages[error]}</p>
          ))}
        </div>
      ) : null}

      <div className="px-4 pb-4 sm:px-5 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
        {!hasFiles ? (
          <div className="rounded-xl border border-dashed border-slate-200 bg-white/70 px-4 py-4 lg:py-6">
            <p className="text-sm font-medium text-slate-700">
              No documents yet
            </p>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              Your selected files and validation results will appear here.
            </p>
          </div>
        ) : (
          <ul className="space-y-2" aria-label="Selected documents">
            {result.files.map(({ errors, file, fileType }, index) => {
              const uploadUpdate = uploadUpdates[index];
              const processingDocument = processingDocuments[index];
              const action = processingDocument
                ? actions[processingDocument.id]
                : undefined;
              const hasError =
                errors.length > 0 ||
                uploadUpdate?.status === "failed" ||
                processingDocument?.status === "failed";
              const operationState = getDocumentOperationState({
                action,
                hasLocalError: errors.length > 0,
                processingDocument,
                uploadUpdate,
              });

              return (
                <li
                  key={`${file.name}-${file.size}-${file.lastModified}-${index}`}
                  className={`document-row-enter rounded-xl border bg-white p-3 ${
                    action === "deleting" ? "document-row-deleting" : ""
                  } ${
                    hasError ? "border-red-200" : "border-slate-200"
                  }`}
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <span
                      className={`grid size-9 shrink-0 place-items-center rounded-lg ${
                        operationState === "ready"
                          ? "bg-emerald-50 text-emerald-700"
                          : hasError
                          ? "bg-red-50 text-red-700"
                          : operationState === "selected"
                            ? "bg-slate-100 text-slate-600"
                            : "bg-blue-50 text-blue-700"
                      }`}
                      aria-hidden="true"
                    >
                      <DocumentOperationIcon state={operationState} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p
                        className="truncate text-sm font-medium text-slate-800"
                        title={file.name}
                      >
                        {file.name}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {fileType?.toUpperCase() ?? "Unsupported"} ·{" "}
                        {formatFileSize(file.size)}
                      </p>
                    </div>
                    {!processingDocument ? (
                      <button
                        type="button"
                        onClick={() => onRemove(index)}
                        disabled={isSelectionLocked}
                        className="grid size-8 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-950 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
                        aria-label={`Remove ${file.name}`}
                      >
                        <Trash2 size={15} aria-hidden="true" />
                      </button>
                    ) : null}
                  </div>

                  {errors.length > 0 ? (
                    <div className="mt-2 border-t border-red-100 pt-2 text-xs leading-5 text-red-700">
                      {errors.map((error) => (
                        <p key={error}>{fileErrorMessages[error]}</p>
                      ))}
                    </div>
                  ) : uploadUpdate &&
                    (uploadUpdate.status === "creating-batch" ||
                      uploadUpdate.status === "uploading") ? (
                    <UploadState update={uploadUpdate} />
                  ) : processingDocument ? (
                    <ProcessingState
                      action={action}
                      actionError={actionErrors[processingDocument.id]}
                      actionsDisabled={actionsDisabled}
                      document={processingDocument}
                      onDelete={() => onDelete(index, processingDocument)}
                      onRetry={() => onRetry(processingDocument)}
                      onToggleChatDocument={() =>
                        onToggleChatDocument(processingDocument.id)
                      }
                      selectedForChat={selectedChatDocumentIdSet.has(
                        processingDocument.id,
                      )}
                      selectedForChatCount={selectedChatDocumentIds.length}
                    />
                  ) : uploadUpdate ? (
                    <UploadState update={uploadUpdate} />
                  ) : (
                    <p className="mt-2 border-t border-slate-100 pt-2 text-xs text-slate-500">
                      Selected · not uploaded
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {hasFiles ? (
        <div className="shrink-0 border-t border-slate-200 bg-white/80 px-4 py-4 sm:px-5">
          {creationError ? (
            <p
              className="mb-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-xs leading-5 text-red-800"
              role="alert"
            >
              {creationError}
            </p>
          ) : null}
          {pendingFileCount > 0 ? (
            <button
              type="button"
              onClick={onSubmitChanges}
              disabled={!canSubmitChanges}
              className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-950 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600"
            >
              <Upload size={16} aria-hidden="true" />
              {isUploading
                ? hasContext
                  ? "Updating context"
                  : "Uploading documents"
                : hasContext
                  ? "Update context"
                  : "Upload"}
            </button>
          ) : canAddFromSidebar ? (
            <button
              type="button"
              onClick={onOpenPicker}
              disabled={isSelectionLocked}
              className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-950 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Plus size={16} aria-hidden="true" />
              Add documents
            </button>
          ) : null}
          <p className="mt-2 text-center text-xs leading-5 text-slate-500">
            {pendingFileCount > 0
              ? `${pendingFileCount} new ${pendingFileCount === 1 ? "document" : "documents"} waiting to be sent.`
              : canAddFromSidebar
                ? "Add or remove documents without replacing the full context."
                : "Document processing is reflected here in real time."}
          </p>
        </div>
      ) : null}

      <div className="hidden shrink-0 border-t border-slate-200 px-5 py-5 lg:block">
        <p className="text-xs font-medium text-slate-700">Session limits</p>
        <dl className="mt-3 space-y-2 text-xs text-slate-500">
          <div className="flex justify-between gap-3">
            <dt>Files</dt>
            <dd className="font-medium text-slate-700">Up to 10</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt>Per file</dt>
            <dd className="font-medium text-slate-700">10 MiB</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt>Batch</dt>
            <dd className="font-medium text-slate-700">50 MiB</dd>
          </div>
        </dl>
      </div>
    </aside>
  );
}

type DocumentSelectorProps = {
  fileCount: number;
  isDragging: boolean;
  isSelectionLocked: boolean;
  onDragEnter: (event: DragEvent<HTMLDivElement>) => void;
  onDragLeave: (event: DragEvent<HTMLDivElement>) => void;
  onDragOver: (event: DragEvent<HTMLDivElement>) => void;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
  onOpenPicker: () => void;
};

function DocumentSelector({
  fileCount,
  isDragging,
  isSelectionLocked,
  onDragEnter,
  onDragLeave,
  onDragOver,
  onDrop,
  onOpenPicker,
}: DocumentSelectorProps) {
  const hasFiles = fileCount > 0;

  return (
    <section
      className="flex min-h-0 w-full flex-1 overflow-y-auto px-4 py-8 text-center sm:px-8 sm:py-10"
      aria-labelledby="workspace-title"
    >
      <div className="mx-auto flex w-full max-w-3xl flex-col items-center justify-center">
        <div className="grid size-12 place-items-center rounded-2xl border border-slate-200 bg-white text-slate-700 shadow-sm">
          <MessageSquareText size={22} strokeWidth={1.7} aria-hidden="true" />
        </div>
        <h1
          id="workspace-title"
          className="mt-5 text-balance text-2xl font-semibold tracking-[-0.025em] text-slate-950 sm:text-3xl"
        >
          {hasFiles ? "Review your documents" : "Start with your documents"}
        </h1>
        <p className="mt-3 max-w-xl text-pretty text-sm leading-6 text-slate-600 sm:text-base sm:leading-7">
          {hasFiles
            ? "Add more documents if needed, then use the action under the document list. Existing files stay in your context."
            : "Add the files you want to explore. Chat becomes available only after every document is processed and indexed."}
        </p>

        <div
          className={`mt-7 w-full rounded-2xl border border-dashed bg-white px-5 py-7 shadow-[0_1px_2px_rgba(15,23,42,0.03)] sm:px-8 sm:py-9 ${
            isDragging ? "border-slate-700 bg-slate-50" : "border-slate-300"
          }`}
          onDragEnter={onDragEnter}
          onDragLeave={onDragLeave}
          onDragOver={onDragOver}
          onDrop={onDrop}
          role="group"
          aria-label="Document drop zone"
          aria-disabled={isSelectionLocked}
        >
          <div className="mx-auto grid size-11 place-items-center rounded-full bg-slate-100 text-slate-700">
            <Upload size={20} strokeWidth={1.8} aria-hidden="true" />
          </div>
          <p className="mt-4 text-sm font-semibold text-slate-900">
            {isDragging
              ? "Drop to add documents"
              : hasFiles
                ? "Add more documents"
                : "Add up to 10 documents at once"}
          </p>
          <p className="mx-auto mt-1.5 max-w-md text-xs leading-5 text-slate-500 sm:text-sm">
            {hasFiles
              ? "New files are added to the current list. Nothing is replaced."
              : "Drag and drop your files here, or select them from your device."}
          </p>
          <button
            type="button"
            onClick={onOpenPicker}
            disabled={isSelectionLocked}
            className="mt-5 inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-950 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            <Plus size={16} aria-hidden="true" />
            {hasFiles ? "Add documents" : "Choose documents"}
          </button>
          <p className="mt-4 text-xs leading-5 text-slate-400">
            {supportedFormats} · 10 MiB per file · 50 MiB per session
          </p>
        </div>
      </div>
    </section>
  );
}

type DisabledComposerProps = {
  batch: BatchSummary | null;
  hasFiles: boolean;
  isUploading: boolean;
  pendingFileCount: number;
  uploadUpdates: UploadUpdates;
};

function DisabledComposer({
  batch,
  hasFiles,
  isUploading,
  pendingFileCount,
  uploadUpdates,
}: DisabledComposerProps) {
  const updates = Object.values(uploadUpdates);
  const hasFailedUpload = updates.some((update) => update?.status === "failed");
  const hasFailedProcessing = batch?.documents.some(
    (document) => document.status === "failed",
  );
  const hasUploadedFile = updates.some(
    (update) => update?.status === "uploaded",
  );
  let reason = "Add and process at least one document to start chatting.";

  if (isUploading) {
    reason = "Documents are uploading. Chat remains unavailable.";
  } else if (pendingFileCount > 0) {
    reason = "Upload the new documents to update the context before chatting.";
  } else if (hasFailedUpload || hasFailedProcessing) {
    reason = "A document failed. Chat remains unavailable.";
  } else if (batch?.status === "ready") {
    reason = "All documents are ready. Chat is available.";
  } else if (batch) {
    reason = "Documents are being processed. Chat remains unavailable.";
  } else if (hasUploadedFile) {
    reason = "Uploaded documents are waiting for full processing.";
  } else if (hasFiles) {
    reason =
      "Selected documents must be uploaded and fully processed before chatting.";
  }

  return (
    <footer className="shrink-0 border-t border-slate-200 bg-white px-3 py-3 sm:px-6 sm:py-4">
      <div className="mx-auto w-full max-w-3xl">
        <div className="relative rounded-2xl border border-slate-200 bg-slate-50 shadow-sm">
          <label htmlFor="message" className="sr-only">
            Message DocChat
          </label>
          <textarea
            id="message"
            rows={1}
            disabled
            aria-describedby="composer-reason"
            placeholder="Ask a question about your documents"
            className="block min-h-14 w-full resize-none overflow-hidden bg-transparent py-4 pr-14 pl-4 text-sm text-slate-900 outline-none placeholder:text-slate-400 disabled:cursor-not-allowed"
          />
          <button
            type="button"
            disabled
            aria-label="Send message"
            className="absolute right-2.5 bottom-2.5 grid size-9 cursor-not-allowed place-items-center rounded-xl bg-slate-200 text-slate-400"
          >
            <ArrowUp size={17} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
        <p
          id="composer-reason"
          className="mt-2 flex items-center justify-center gap-1.5 text-center text-xs leading-5 text-slate-500"
        >
          <LockKeyhole size={13} className="shrink-0" aria-hidden="true" />
          {reason}
        </p>
      </div>
    </footer>
  );
}

export function DocumentSelectionWorkspace() {
  const inputRef = useRef<HTMLInputElement>(null);
  const uploadInFlightRef = useRef(false);
  const documentActionInFlightRef = useRef(false);
  const pollingAbortRef = useRef<AbortController | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [batch, setBatch] = useState<BatchSummary | null>(null);
  const [documentIdsByIndex, setDocumentIdsByIndex] = useState<
    Partial<Record<number, string>>
  >({});
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [creationError, setCreationError] = useState<string | null>(null);
  const [documentActions, setDocumentActions] = useState<DocumentActions>({});
  const [documentActionErrors, setDocumentActionErrors] =
    useState<DocumentActionErrors>({});
  const [excludedChatDocumentIds, setExcludedChatDocumentIds] = useState<
    string[]
  >([]);
  const [uploadUpdates, setUploadUpdates] = useState<UploadUpdates>({});
  const validationResult = useMemo(
    () => validateBatchFiles(selectedFiles),
    [selectedFiles],
  );
  const processingDocuments = useMemo(() => {
    const documentsById = new Map(
      batch?.documents.map((document) => [document.id, document]) ?? [],
    );

    return Object.fromEntries(
      Object.entries(documentIdsByIndex).flatMap(([index, documentId]) => {
        const document = documentId
          ? documentsById.get(documentId)
          : undefined;

        return document ? [[Number(index), document]] : [];
      }),
    ) as ProcessingDocuments;
  }, [batch, documentIdsByIndex]);
  const pendingFiles = useMemo(
    () =>
      selectedFiles.flatMap((file, index) =>
        documentIdsByIndex[index] ? [] : [{ file, index }],
      ),
    [documentIdsByIndex, selectedFiles],
  );
  const isBatchProcessing = Boolean(
    batch?.status === "processing" ||
      batch?.documents.some(
        (document) =>
          document.status !== "ready" && document.status !== "failed",
      ),
  );
  const isSelectionLocked =
    isUploading || isBatchProcessing || Object.keys(documentActions).length > 0;
  const canSubmitChanges =
    pendingFiles.length > 0 &&
    validationResult.isValid &&
    !isSelectionLocked;
  const readyDocumentIds = useMemo(
    () =>
      batch?.status === "ready" &&
      batch.documents.length > 0 &&
      batch.documents.every((document) => document.status === "ready")
        ? batch.documents.map((document) => document.id)
        : [],
    [batch],
  );
  const canChat =
    batch !== null && pendingFiles.length === 0 && readyDocumentIds.length > 0;
  const excludedChatDocumentIdSet = new Set(excludedChatDocumentIds);
  const chatDocumentIds = readyDocumentIds.filter(
    (id) => !excludedChatDocumentIdSet.has(id),
  );

  useEffect(
    () => () => {
      pollingAbortRef.current?.abort();
    },
    [],
  );

  function startBatchPolling(batchId: string): void {
    const controller = new AbortController();
    pollingAbortRef.current?.abort();
    pollingAbortRef.current = controller;
    void pollBatchStatus(batchId, (nextBatch) => setBatch(nextBatch), {
      signal: controller.signal,
    }).catch((error) => {
      if (!controller.signal.aborted) {
        const message =
          error instanceof Error
            ? error.message
            : "The batch status could not be loaded.";
        setCreationError(`Status update failed: ${message}`);
      }
    });
  }

  function setDocumentActionError(
    documentId: string,
    error?: string,
  ): void {
    setDocumentActionErrors((current) => {
      const next = { ...current };

      if (error) {
        next[documentId] = error;
      } else {
        delete next[documentId];
      }

      return next;
    });
  }

  function addToSelection(files: FileList | readonly File[]): void {
    if (isSelectionLocked) {
      return;
    }

    setSelectedFiles((current) => [...current, ...Array.from(files)]);
    setCreationError(null);
  }

  function handleInputChange(event: ChangeEvent<HTMLInputElement>): void {
    addToSelection(event.target.files ?? []);
    event.target.value = "";
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault();

    if (isSelectionLocked) {
      event.dataTransfer.dropEffect = "none";
      return;
    }

    event.dataTransfer.dropEffect = "copy";
    setIsDragging(true);
  }

  function handleDragEnter(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault();

    if (isSelectionLocked) {
      return;
    }

    setIsDragging(true);
  }

  function handleDragLeave(event: DragEvent<HTMLDivElement>): void {
    if (
      event.relatedTarget instanceof Node &&
      event.currentTarget.contains(event.relatedTarget)
    ) {
      return;
    }

    setIsDragging(false);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault();

    if (isSelectionLocked) {
      return;
    }

    setIsDragging(false);

    if (event.dataTransfer.files.length === 0) {
      return;
    }

    addToSelection(event.dataTransfer.files);
  }

  function handleRemove(indexToRemove: number): void {
    if (isSelectionLocked || documentIdsByIndex[indexToRemove]) {
      return;
    }

    setSelectedFiles((files) =>
      files.filter((_, index) => index !== indexToRemove),
    );
    setCreationError(null);
    setUploadUpdates((current) => removeIndexedValue(current, indexToRemove));
    setDocumentIdsByIndex((current) =>
      removeIndexedValue(current, indexToRemove),
    );
  }

  function handleToggleChatDocument(documentId: string): void {
    setExcludedChatDocumentIds((current) => {
      if (current.includes(documentId)) {
        return current.filter((id) => id !== documentId);
      }

      const selectedCount = readyDocumentIds.filter(
        (id) => !current.includes(id),
      ).length;

      return selectedCount === 1 ? current : [...current, documentId];
    });
  }

  async function handleRetryDocument(
    document: DocumentSummary,
  ): Promise<void> {
    if (documentActionInFlightRef.current || !batch) {
      return;
    }

    documentActionInFlightRef.current = true;
    setDocumentActionError(document.id);
    setDocumentActions({ [document.id]: "retrying" });

    try {
      const retried = await retryDocument(document.id);
      setBatch((current) => {
        if (!current) {
          return current;
        }

        const documents = current.documents.map((currentDocument) =>
          currentDocument.id === retried.id ? retried : currentDocument,
        );

        return {
          ...current,
          documents,
          status: getBatchStatusFromDocuments(documents),
        };
      });
      startBatchPolling(batch.id);
    } catch (error) {
      setDocumentActionError(
        document.id,
        error instanceof Error ? error.message : "The retry failed.",
      );
    } finally {
      documentActionInFlightRef.current = false;
      setDocumentActions({});
    }
  }

  async function handleDeleteDocument(
    index: number,
    document: DocumentSummary,
  ): Promise<void> {
    if (documentActionInFlightRef.current) {
      return;
    }

    documentActionInFlightRef.current = true;
    setDocumentActionError(document.id);
    setDocumentActions({ [document.id]: "deleting" });

    try {
      await deleteDocument(document.id);
      const remainingFiles = selectedFiles.filter(
        (_, fileIndex) => fileIndex !== index,
      );
      setSelectedFiles(remainingFiles);
      setUploadUpdates((current) => removeIndexedValue(current, index));
      setDocumentIdsByIndex((current) => removeIndexedValue(current, index));
      setDocumentActionErrors((current) => {
        const next = { ...current };
        delete next[document.id];
        return next;
      });
      setBatch((current) => {
        if (!current) {
          return current;
        }

        const documents = current.documents.filter(
          (currentDocument) => currentDocument.id !== document.id,
        );

        return documents.length === 0
          ? null
          : {
              ...current,
              documents,
              status: getBatchStatusFromDocuments(documents),
            };
      });

      if (remainingFiles.length === 0) {
        pollingAbortRef.current?.abort();
        setUploadUpdates({});
        setDocumentIdsByIndex({});
        setCreationError(null);
      }
    } catch (error) {
      setDocumentActionError(
        document.id,
        error instanceof Error ? error.message : "The deletion failed.",
      );
    } finally {
      documentActionInFlightRef.current = false;
      setDocumentActions({});
    }
  }

  async function handleUpload(): Promise<void> {
    if (!canSubmitChanges || uploadInFlightRef.current) {
      return;
    }

    uploadInFlightRef.current = true;
    setIsUploading(true);
    setCreationError(null);

    try {
      const updateProgress = (update: ClientUploadUpdate) => {
        setUploadUpdates((current) => ({
          ...current,
          [update.index]: update,
        }));
      };
      const result = batch
        ? await addAndUploadDocuments(
            batch.id,
            pendingFiles,
            updateProgress,
          )
        : await createAndUploadBatch(selectedFiles, updateProgress);

      setBatch(result.batch);
      setDocumentIdsByIndex((current) => ({
        ...(batch ? current : {}),
        ...Object.fromEntries(
          result.uploads
            .filter((upload) => upload.documentId)
            .map((upload) => [upload.index, upload.documentId]),
        ),
      }));

      startBatchPolling(result.batch.id);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : batch
            ? "The context could not be updated."
            : "The batch could not be created.";

      setUploadUpdates((current) => {
        const next = { ...current };

        for (const { index } of pendingFiles) {
          delete next[index];
        }

        return next;
      });
      setCreationError(
        `${batch ? "Context update" : "Upload"} failed: ${message}`,
      );
    } finally {
      uploadInFlightRef.current = false;
      setIsUploading(false);
    }
  }

  return (
    <main className="grid min-h-0 min-w-0 w-full flex-1 grid-rows-[auto_1fr] lg:grid-cols-[280px_minmax(0,1fr)] lg:grid-rows-1 lg:overflow-hidden">
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={acceptedFileTypes}
        onChange={handleInputChange}
        disabled={isSelectionLocked}
        className="sr-only"
        aria-label="Select documents from device"
      />
      <DocumentsPanel
        actionErrors={documentActionErrors}
        actions={documentActions}
        canAddFromSidebar={canChat}
        canSubmitChanges={canSubmitChanges}
        creationError={creationError}
        hasContext={batch !== null}
        isSelectionLocked={isSelectionLocked}
        isUploading={isUploading}
        onDelete={handleDeleteDocument}
        onOpenPicker={() => inputRef.current?.click()}
        processingDocuments={processingDocuments}
        result={validationResult}
        uploadUpdates={uploadUpdates}
        onRemove={handleRemove}
        onRetry={handleRetryDocument}
        onSubmitChanges={handleUpload}
        onToggleChatDocument={handleToggleChatDocument}
        pendingFileCount={pendingFiles.length}
        selectedChatDocumentIds={chatDocumentIds}
      />
      <section
        className="flex min-h-0 min-w-0 flex-col bg-slate-50/30"
        aria-label="Conversation workspace"
      >
        {canChat ? (
          <ChatWorkspace
            key={`${batch.id}:${chatDocumentIds.join(",")}`}
            batchId={batch.id}
            documentIds={chatDocumentIds}
          />
        ) : (
          <>
            <DocumentSelector
              fileCount={validationResult.files.length}
              isDragging={isDragging}
              isSelectionLocked={isSelectionLocked}
              onDragEnter={handleDragEnter}
              onDragLeave={handleDragLeave}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              onOpenPicker={() => inputRef.current?.click()}
            />
            <DisabledComposer
              batch={batch}
              hasFiles={validationResult.files.length > 0}
              isUploading={isUploading}
              pendingFileCount={pendingFiles.length}
              uploadUpdates={uploadUpdates}
            />
          </>
        )}
      </section>
    </main>
  );
}
