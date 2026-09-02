"use client";

import {
  ArrowUp,
  CheckCircle2,
  CircleEllipsis,
  Clock3,
  Files,
  LockKeyhole,
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
import { RagPipelineVisualizer } from "./rag-pipeline-visualizer";

const acceptedFileTypes = ".pdf,.docx,.pptx,.xlsx,.txt,.md,.csv";
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
  isDragging: boolean;
  isUploading: boolean;
  onDragEnter: (event: DragEvent<HTMLElement>) => void;
  onDragLeave: (event: DragEvent<HTMLElement>) => void;
  onDragOver: (event: DragEvent<HTMLElement>) => void;
  onDrop: (event: DragEvent<HTMLElement>) => void;
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
        className="mt-2 flex items-center gap-1.5 border-t border-slate-100 pt-2 text-xs text-slate-600 dark:border-slate-800 dark:text-slate-300"
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
      <div className="mt-2 border-t border-slate-100 pt-2 dark:border-slate-800">
        <div className="flex items-center justify-between gap-3 text-xs text-slate-600 dark:text-slate-300">
          <span>Uploading</span>
          <span className="font-medium tabular-nums">{progress}%</span>
        </div>
        <div
          className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"
          role="progressbar"
          aria-label={`Uploading ${progress}%`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress}
        >
          <div
            className="h-full rounded-full bg-slate-700 dark:bg-blue-500"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
    );
  }

  if (update.status === "uploaded") {
    return (
      <p
        className="mt-2 flex items-center gap-1.5 border-t border-slate-100 pt-2 text-xs text-blue-800 dark:border-slate-800 dark:text-blue-300"
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
      className="mt-2 border-t border-red-100 pt-2 text-xs leading-5 text-red-700 dark:border-red-950 dark:text-red-300"
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
      <div className="mt-3 border-t border-emerald-100 pt-3 dark:border-emerald-950">
        <p
          className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400"
          role="status"
          aria-live="polite"
        >
          <CheckCircle2 className="shrink-0" size={14} aria-hidden="true" />
          Ready
        </p>
        <div className="mt-2.5 flex min-w-0 items-stretch gap-2">
          <label className="inline-flex h-9 min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs font-medium text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-100 has-disabled:cursor-not-allowed has-disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-slate-600 dark:hover:bg-slate-800">
            <input
              type="checkbox"
              checked={selectedForChat}
              onChange={onToggleChatDocument}
              disabled={selectedForChat && selectedForChatCount === 1}
              className="size-3.5 shrink-0 accent-slate-900 dark:accent-blue-500"
              aria-label={`Use ${document.filename} in chat`}
            />
            <span className="truncate">
              {selectedForChat ? "Included in chat" : "Include in chat"}
            </span>
          </label>
          <button
            type="button"
            onClick={onDelete}
            disabled={actionsDisabled}
            className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-transparent px-2.5 text-xs font-medium text-slate-500 hover:border-red-200 hover:bg-red-50 hover:text-red-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-950 disabled:cursor-wait disabled:opacity-50 dark:text-slate-400 dark:hover:border-red-900 dark:hover:bg-red-950/60 dark:hover:text-red-300 dark:focus-visible:outline-slate-200"
            aria-label={`Delete ${document.filename}`}
          >
            {action === "deleting" ? (
              <Trash2
                className="document-delete-once shrink-0"
                size={14}
                aria-hidden="true"
              />
            ) : (
              <Trash2 className="shrink-0" size={14} aria-hidden="true" />
            )}
            {action === "deleting" ? "Deleting" : "Delete"}
          </button>
        </div>
        {actionError ? (
          <p className="mt-2 text-xs leading-5 text-red-700 dark:text-red-300" role="alert">
            {actionError}
          </p>
        ) : null}
      </div>
    );
  }

  if (document.status === "failed") {
    return (
      <div
        className="mt-2 border-t border-red-100 pt-2 text-xs leading-5 text-red-700 dark:border-red-950 dark:text-red-300"
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
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-950 disabled:cursor-wait disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 dark:focus-visible:outline-slate-200"
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
            className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-2.5 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700 disabled:cursor-wait disabled:opacity-50 dark:border-red-900 dark:bg-slate-900 dark:text-red-300 dark:hover:bg-red-950/60"
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
          <p className="mt-2 text-xs leading-5 text-red-700 dark:text-red-300" role="alert">
            {actionError}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <p
      className="mt-2 flex items-center gap-1.5 border-t border-slate-100 pt-2 text-xs text-blue-800 dark:border-slate-800 dark:text-blue-300"
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
  isDragging,
  isSelectionLocked,
  isUploading,
  onDragEnter,
  onDragLeave,
  onDragOver,
  onDrop,
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
      className={`relative min-w-0 border-b bg-slate-50/70 transition-colors dark:bg-slate-900/70 lg:flex lg:min-h-0 lg:flex-col lg:overflow-hidden lg:border-r lg:border-b-0 ${
        isDragging
          ? "border-blue-400 bg-blue-50/80 ring-2 ring-inset ring-blue-400 dark:border-blue-500 dark:bg-blue-950/30 dark:ring-blue-500"
          : "border-slate-200 dark:border-slate-800"
      }`}
      aria-labelledby="documents-heading"
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <div className="flex shrink-0 items-center justify-between px-4 py-4 sm:px-5 lg:py-5">
        <div className="flex items-center gap-2.5">
          <Files size={17} className="text-slate-500 dark:text-slate-400" aria-hidden="true" />
          <h2
            id="documents-heading"
            className="text-sm font-semibold text-slate-900 dark:text-slate-100"
          >
            Documents
          </h2>
        </div>
        <span
          className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-xs font-medium tabular-nums text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
          aria-label={`${result.files.length} documents`}
        >
          {result.files.length}
        </span>
      </div>

      {result.errors.length > 0 ? (
        <div
          className="mx-4 mb-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-xs leading-5 text-red-800 dark:border-red-900 dark:bg-red-950/60 dark:text-red-300 sm:mx-5"
          role="alert"
        >
          {result.errors.map((error) => (
            <p key={error}>{batchErrorMessages[error]}</p>
          ))}
        </div>
      ) : null}

      <div className="px-4 pb-4 sm:px-5 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
        {!hasFiles ? (
          <div
            className={`rounded-xl border border-dashed bg-white/70 px-4 py-5 text-center transition-colors dark:bg-slate-950/40 ${
              isDragging
                ? "border-blue-500 bg-blue-50 dark:border-blue-400 dark:bg-blue-950/50"
                : "border-slate-300 dark:border-slate-700"
            }`}
            role="group"
            aria-label="Document drop zone"
            aria-disabled={isSelectionLocked}
          >
            <div className="mx-auto grid size-10 place-items-center rounded-xl bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200">
              <Upload size={18} strokeWidth={1.8} aria-hidden="true" />
            </div>
            <h3 className="mt-3 text-sm font-semibold text-slate-900 dark:text-slate-100">
              Start with your documents
            </h3>
            <p className="mt-1.5 text-xs leading-5 text-slate-500 dark:text-slate-400">
              {isDragging
                ? "Drop to add documents"
                : "Choose or drop files here. Chat unlocks after they are indexed."}
            </p>
            <button
              type="button"
              onClick={onOpenPicker}
              disabled={isSelectionLocked}
              className="mt-4 inline-flex h-9 w-full items-center justify-center gap-2 rounded-xl bg-slate-950 px-3 text-xs font-semibold text-white shadow-sm hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-950 disabled:cursor-not-allowed disabled:bg-slate-300 dark:bg-blue-600 dark:hover:bg-blue-500 dark:focus-visible:outline-slate-200 dark:disabled:bg-slate-800 dark:disabled:text-slate-500"
            >
              <Plus size={15} aria-hidden="true" />
              Choose documents
            </button>
          </div>
        ) : (
          <>
            <div className="mb-3 px-0.5">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Review your documents
              </h3>
              <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">
                {hasContext
                  ? "Add or remove files here. Existing files stay in your context."
                  : "Check the files, then use the upload action below."}
              </p>
            </div>
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
                  className={`document-row-enter rounded-xl border bg-white p-3.5 dark:bg-slate-950/70 ${
                    action === "deleting" ? "document-row-deleting" : ""
                  } ${
                    hasError
                      ? "border-red-200 dark:border-red-900"
                      : "border-slate-200 dark:border-slate-800"
                  }`}
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <span
                      className={`grid size-10 shrink-0 place-items-center rounded-xl ${
                        operationState === "ready"
                          ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400"
                          : hasError
                          ? "bg-red-50 text-red-700 dark:bg-red-950/60 dark:text-red-300"
                          : operationState === "selected"
                            ? "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                            : "bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300"
                      }`}
                      aria-hidden="true"
                    >
                      <DocumentOperationIcon state={operationState} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p
                        className="line-clamp-2 break-words text-sm font-semibold leading-5 text-slate-800 dark:text-slate-100"
                        title={file.name}
                      >
                        {file.name}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                        {fileType?.toUpperCase() ?? "Unsupported"} ·{" "}
                        {formatFileSize(file.size)}
                      </p>
                    </div>
                    {!processingDocument ? (
                      <button
                        type="button"
                        onClick={() => onRemove(index)}
                        disabled={isSelectionLocked}
                        className="grid size-8 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-950 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-slate-200 dark:focus-visible:outline-slate-200"
                        aria-label={`Remove ${file.name}`}
                      >
                        <Trash2 size={15} aria-hidden="true" />
                      </button>
                    ) : null}
                  </div>

                  {errors.length > 0 ? (
                    <div className="mt-2 border-t border-red-100 pt-2 text-xs leading-5 text-red-700 dark:border-red-950 dark:text-red-300">
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
                    <p className="mt-2 border-t border-slate-100 pt-2 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
                      Selected · not uploaded
                    </p>
                  )}
                </li>
                );
              })}
            </ul>
          </>
        )}
      </div>

      {hasFiles ? (
        <div className="shrink-0 border-t border-slate-200 bg-white/80 px-4 py-4 dark:border-slate-800 dark:bg-slate-900/90 sm:px-5">
          {creationError ? (
            <p
              className="mb-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-xs leading-5 text-red-800 dark:border-red-900 dark:bg-red-950/60 dark:text-red-300"
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
              className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-950 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600 dark:bg-blue-600 dark:hover:bg-blue-500 dark:focus-visible:outline-slate-200 dark:disabled:bg-slate-800 dark:disabled:text-slate-500"
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
          ) : null}
          {canAddFromSidebar ? (
            <button
              type="button"
              onClick={onOpenPicker}
              disabled={isSelectionLocked}
              className={`inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-950 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 dark:focus-visible:outline-slate-200 ${
                pendingFileCount > 0 ? "mt-2" : ""
              }`}
            >
              <Plus size={16} aria-hidden="true" />
              Add documents
            </button>
          ) : null}
          {pendingFileCount > 0 ? (
            <p className="mt-2 text-center text-xs leading-5 text-slate-500 dark:text-slate-400">
              {isUploading
                ? "Sending and processing the new documents."
                : `${pendingFileCount} new ${pendingFileCount === 1 ? "document" : "documents"} waiting to be sent.`}
            </p>
          ) : null}
        </div>
      ) : null}

    </aside>
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
    <footer className="shrink-0 bg-transparent px-3 pt-2 pb-3 sm:px-6 sm:pt-3 sm:pb-4">
      <div className="mx-auto w-full max-w-3xl">
        <div className="relative rounded-2xl border border-white/80 bg-white/80 shadow-[0_12px_35px_-20px_rgba(15,23,42,0.45)] backdrop-blur-xl dark:border-slate-700/80 dark:bg-slate-900/80">
          <label htmlFor="message" className="sr-only">
            Message DocChat
          </label>
          <textarea
            id="message"
            rows={1}
            disabled
            aria-describedby="composer-reason"
            placeholder="Ask a question about your documents"
            className="block min-h-14 w-full resize-none overflow-hidden bg-transparent py-4 pr-14 pl-4 text-sm text-slate-900 outline-none placeholder:text-slate-400 disabled:cursor-not-allowed dark:text-slate-100 dark:placeholder:text-slate-500"
          />
          <button
            type="button"
            disabled
            aria-label="Send message"
            className="absolute right-2.5 bottom-2.5 grid size-9 cursor-not-allowed place-items-center rounded-xl bg-slate-200 text-slate-400 dark:bg-slate-800 dark:text-slate-500"
          >
            <ArrowUp size={17} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
        <p
          id="composer-reason"
          className="mt-2 flex items-center justify-center gap-1.5 text-center text-xs leading-5 text-slate-500 dark:text-slate-400"
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
  const isDocumentContextUpdating = Object.keys(documentActions).length > 0;
  const isSelectionLocked =
    isUploading || isBatchProcessing || isDocumentContextUpdating;
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
    batch !== null &&
    pendingFiles.length === 0 &&
    readyDocumentIds.length > 0;
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
    const additions = Array.from(files);

    if (isSelectionLocked || additions.length === 0) {
      return;
    }

    setSelectedFiles((current) => [...current, ...additions]);
    setCreationError(null);
  }

  function handleInputChange(event: ChangeEvent<HTMLInputElement>): void {
    const additions = Array.from(event.target.files ?? []);
    event.target.value = "";

    if (isSelectionLocked || additions.length === 0) {
      return;
    }

    const firstAdditionIndex = selectedFiles.length;
    const nextFiles = [...selectedFiles, ...additions];
    setSelectedFiles(nextFiles);
    setCreationError(null);

    if (batch && canChat && validateBatchFiles(nextFiles).isValid) {
      void uploadFiles({
        allFiles: nextFiles,
        filesToUpload: additions.map((file, offset) => ({
          file,
          index: firstAdditionIndex + offset,
        })),
        targetBatch: batch,
      });
    }
  }

  function handleDragOver(event: DragEvent<HTMLElement>): void {
    event.preventDefault();

    if (isSelectionLocked) {
      event.dataTransfer.dropEffect = "none";
      return;
    }

    event.dataTransfer.dropEffect = "copy";
    setIsDragging(true);
  }

  function handleDragEnter(event: DragEvent<HTMLElement>): void {
    event.preventDefault();

    if (isSelectionLocked) {
      return;
    }

    setIsDragging(true);
  }

  function handleDragLeave(event: DragEvent<HTMLElement>): void {
    if (
      event.relatedTarget instanceof Node &&
      event.currentTarget.contains(event.relatedTarget)
    ) {
      return;
    }

    setIsDragging(false);
  }

  function handleDrop(event: DragEvent<HTMLElement>): void {
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
      setExcludedChatDocumentIds((current) =>
        current.filter((documentId) => documentId !== document.id),
      );
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

  async function uploadFiles(input: {
    allFiles: readonly File[];
    filesToUpload: readonly { file: File; index: number }[];
    targetBatch: BatchSummary | null;
  }): Promise<void> {
    if (input.filesToUpload.length === 0 || uploadInFlightRef.current) {
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
      const result = input.targetBatch
        ? await addAndUploadDocuments(
            input.targetBatch.id,
            input.filesToUpload,
            updateProgress,
          )
        : await createAndUploadBatch(input.allFiles, updateProgress);

      setBatch(result.batch);
      setDocumentIdsByIndex((current) => ({
        ...(input.targetBatch ? current : {}),
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
          : input.targetBatch
            ? "The context could not be updated."
            : "The batch could not be created.";

      setUploadUpdates((current) => {
        const next = { ...current };

        for (const { index } of input.filesToUpload) {
          delete next[index];
        }

        return next;
      });
      setCreationError(
        `${input.targetBatch ? "Context update" : "Upload"} failed: ${message}`,
      );
    } finally {
      uploadInFlightRef.current = false;
      setIsUploading(false);
    }
  }

  async function handleUpload(): Promise<void> {
    if (!canSubmitChanges) {
      return;
    }

    await uploadFiles({
      allFiles: selectedFiles,
      filesToUpload: pendingFiles,
      targetBatch: batch,
    });
  }

  return (
    <main className="grid min-h-0 min-w-0 w-full flex-1 grid-rows-[auto_1fr] lg:grid-cols-[320px_minmax(0,1fr)] lg:grid-rows-1 lg:overflow-hidden">
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
        canAddFromSidebar={validationResult.files.length < 10}
        canSubmitChanges={canSubmitChanges}
        creationError={creationError}
        hasContext={batch !== null}
        isDragging={isDragging}
        isSelectionLocked={isSelectionLocked}
        isUploading={isUploading}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
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
        className="conversation-surface flex min-h-0 min-w-0 flex-col overflow-hidden"
        aria-label="Conversation workspace"
      >
        {canChat ? (
          <ChatWorkspace
            key={`${batch.id}:${chatDocumentIds.join(",")}`}
            batchId={batch.id}
            documentIds={chatDocumentIds}
            isContextUpdating={isDocumentContextUpdating}
          />
        ) : (
          <>
            <RagPipelineVisualizer
              documentCount={validationResult.files.length}
              mode={isUploading || isBatchProcessing ? "processing" : "waiting"}
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
