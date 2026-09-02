"use client";

import {
  AlertCircle,
  ArrowUp,
  CircleEllipsis,
  Clock3,
  FileText,
  Files,
  LockKeyhole,
  MessageSquareText,
  Plus,
  Trash2,
  Upload,
} from "lucide-react";
import {
  type ChangeEvent,
  type DragEvent,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  createAndUploadBatch,
  type ClientUploadUpdate,
} from "@/lib/uploads/client";
import {
  validateBatchFiles,
  type BatchValidationErrorCode,
  type FileValidationErrorCode,
} from "@/lib/uploads/validation";

const acceptedFileTypes = ".pdf,.docx,.pptx,.xlsx,.txt,.md,.csv";
const supportedFormats = "PDF, DOCX, PPTX, XLSX, TXT, MD and CSV";

const fileErrorMessages: Record<FileValidationErrorCode, string> = {
  EMPTY_FILE: "This file is empty.",
  FILE_TOO_LARGE: "This file exceeds the 10 MiB limit.",
  MIME_TYPE_MISMATCH: "The file content type does not match its extension.",
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

type SelectionResult = ReturnType<typeof validateBatchFiles<File>>;
type UploadUpdates = Partial<Record<number, ClientUploadUpdate>>;

type DocumentsPanelProps = {
  isSelectionLocked: boolean;
  onRemove: (index: number) => void;
  result: SelectionResult;
  uploadUpdates: UploadUpdates;
};

function UploadState({ update }: { update: ClientUploadUpdate }) {
  if (update.status === "creating-batch") {
    return (
      <p
        className="mt-2 flex items-center gap-1.5 border-t border-slate-100 pt-2 text-xs text-slate-600"
        role="status"
      >
        <CircleEllipsis size={13} aria-hidden="true" />
        Creating batch
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

function DocumentsPanel({
  isSelectionLocked,
  onRemove,
  result,
  uploadUpdates,
}: DocumentsPanelProps) {
  const hasFiles = result.files.length > 0;

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
              const hasError =
                errors.length > 0 || uploadUpdate?.status === "failed";

              return (
                <li
                  key={`${file.name}-${file.size}-${file.lastModified}-${index}`}
                  className={`rounded-xl border bg-white p-3 ${
                    hasError ? "border-red-200" : "border-slate-200"
                  }`}
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <span
                      className={`grid size-9 shrink-0 place-items-center rounded-lg ${
                        hasError
                          ? "bg-red-50 text-red-700"
                          : "bg-slate-100 text-slate-600"
                      }`}
                      aria-hidden="true"
                    >
                      {hasError ? (
                        <AlertCircle size={17} />
                      ) : (
                        <FileText size={17} />
                      )}
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
                    <button
                      type="button"
                      onClick={() => onRemove(index)}
                      disabled={isSelectionLocked}
                      className="grid size-8 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-950 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
                      aria-label={`Remove ${file.name}`}
                    >
                      <Trash2 size={15} aria-hidden="true" />
                    </button>
                  </div>

                  {errors.length > 0 ? (
                    <div className="mt-2 border-t border-red-100 pt-2 text-xs leading-5 text-red-700">
                      {errors.map((error) => (
                        <p key={error}>{fileErrorMessages[error]}</p>
                      ))}
                    </div>
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
  creationError: string | null;
  fileCount: number;
  hasUploadStarted: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
  isDragging: boolean;
  isSelectionLocked: boolean;
  isUploading: boolean;
  isValid: boolean;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onDragEnter: (event: DragEvent<HTMLDivElement>) => void;
  onDragLeave: (event: DragEvent<HTMLDivElement>) => void;
  onDragOver: (event: DragEvent<HTMLDivElement>) => void;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
  onOpenPicker: () => void;
  onUpload: () => void;
};

function DocumentSelector({
  creationError,
  fileCount,
  hasUploadStarted,
  inputRef,
  isDragging,
  isSelectionLocked,
  isUploading,
  isValid,
  onChange,
  onDragEnter,
  onDragLeave,
  onDragOver,
  onDrop,
  onOpenPicker,
  onUpload,
}: DocumentSelectorProps) {
  const hasFiles = fileCount > 0;
  const canUpload = isValid && !isUploading && !hasUploadStarted;

  return (
    <section
      className="mx-auto flex min-h-0 w-full max-w-2xl flex-1 flex-col items-center justify-center overflow-y-auto px-4 py-10 text-center sm:px-8 sm:py-14"
      aria-labelledby="workspace-title"
    >
      <div className="grid size-12 place-items-center rounded-2xl border border-slate-200 bg-white text-slate-700 shadow-sm">
        <MessageSquareText size={22} strokeWidth={1.7} aria-hidden="true" />
      </div>
      <h1
        id="workspace-title"
        className="mt-5 text-balance text-2xl font-semibold tracking-[-0.025em] text-slate-950 sm:text-3xl"
      >
        {hasFiles ? "Review your documents" : "Start with your documents"}
      </h1>
      <p className="mt-3 max-w-lg text-pretty text-sm leading-6 text-slate-600 sm:text-base sm:leading-7">
        {hasFiles
          ? "Check every file before continuing. Replacing the selection will remove the current list."
          : "Add the files you want to explore. Chat becomes available only after every document is processed and indexed."}
      </p>

      <div
        className={`mt-7 w-full rounded-2xl border border-dashed bg-white px-5 py-7 shadow-[0_1px_2px_rgba(15,23,42,0.03)] sm:px-8 sm:py-9 ${
          isDragging
            ? "border-slate-700 bg-slate-50"
            : "border-slate-300"
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
            ? "Drop to replace the selection"
            : hasFiles
              ? `${fileCount} ${fileCount === 1 ? "file" : "files"} selected`
              : "Add up to 10 documents at once"}
        </p>
        <p className="mx-auto mt-1.5 max-w-md text-xs leading-5 text-slate-500 sm:text-sm">
          {hasFiles
            ? "Choose or drop another batch to replace your current selection."
            : "Drag and drop your files here, or select them from your device."}
        </p>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={acceptedFileTypes}
          onChange={onChange}
          disabled={isSelectionLocked}
          className="sr-only"
          aria-label="Select documents from device"
        />
        <button
          type="button"
          onClick={onOpenPicker}
          disabled={isSelectionLocked}
          className="mt-5 inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-950 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          <Plus size={16} aria-hidden="true" />
          {hasFiles ? "Replace selection" : "Choose documents"}
        </button>
        <p className="mt-4 text-xs leading-5 text-slate-400">
          {supportedFormats} · 10 MiB per file · 50 MiB per batch
        </p>
      </div>

      {hasFiles ? (
        <div className="mt-4 w-full" aria-live="polite">
          {creationError ? (
            <p
              className="mx-auto mb-3 max-w-lg rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm leading-5 text-red-800"
              role="alert"
            >
              {creationError}
            </p>
          ) : null}
          <button
            type="button"
            onClick={onUpload}
            disabled={!canUpload}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-slate-950 px-5 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-950 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600"
          >
            <Upload size={16} aria-hidden="true" />
            {isUploading
              ? "Uploading documents"
              : hasUploadStarted
                ? "Upload attempt finished"
                : "Upload and process"}
          </button>
          <p className="mt-2 text-xs leading-5 text-slate-500">
            {isUploading
              ? "Upload in progress. Keep this page open."
              : hasUploadStarted
                ? "The file list shows the latest real upload result."
                : "Files are selected locally and have not been uploaded."}
          </p>
        </div>
      ) : null}
    </section>
  );
}

type DisabledComposerProps = {
  hasFiles: boolean;
  isUploading: boolean;
  uploadUpdates: UploadUpdates;
};

function DisabledComposer({
  hasFiles,
  isUploading,
  uploadUpdates,
}: DisabledComposerProps) {
  const updates = Object.values(uploadUpdates);
  const hasFailedUpload = updates.some((update) => update?.status === "failed");
  const hasUploadedFile = updates.some(
    (update) => update?.status === "uploaded",
  );
  let reason = "Add and process at least one document to start chatting.";

  if (isUploading) {
    reason = "Documents are uploading. Chat remains unavailable.";
  } else if (hasFailedUpload) {
    reason = "A file upload failed. Chat remains unavailable.";
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
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [creationError, setCreationError] = useState<string | null>(null);
  const [uploadUpdates, setUploadUpdates] = useState<UploadUpdates>({});
  const validationResult = useMemo(
    () => validateBatchFiles(selectedFiles),
    [selectedFiles],
  );
  const hasUploadStarted = Object.keys(uploadUpdates).length > 0;
  const isSelectionLocked = isUploading || hasUploadStarted;

  function replaceSelection(files: FileList | readonly File[]): void {
    if (uploadInFlightRef.current || hasUploadStarted) {
      return;
    }

    setSelectedFiles(Array.from(files));
    setCreationError(null);
    setUploadUpdates({});
  }

  function handleInputChange(event: ChangeEvent<HTMLInputElement>): void {
    replaceSelection(event.target.files ?? []);
    event.target.value = "";
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault();

    if (uploadInFlightRef.current || hasUploadStarted) {
      event.dataTransfer.dropEffect = "none";
      return;
    }

    event.dataTransfer.dropEffect = "copy";
    setIsDragging(true);
  }

  function handleDragEnter(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault();

    if (uploadInFlightRef.current || hasUploadStarted) {
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

    if (uploadInFlightRef.current || hasUploadStarted) {
      return;
    }

    setIsDragging(false);

    if (event.dataTransfer.files.length === 0) {
      return;
    }

    replaceSelection(event.dataTransfer.files);
  }

  function handleRemove(indexToRemove: number): void {
    if (uploadInFlightRef.current || hasUploadStarted) {
      return;
    }

    setSelectedFiles((files) =>
      files.filter((_, index) => index !== indexToRemove),
    );
    setCreationError(null);
    setUploadUpdates({});
  }

  async function handleUpload(): Promise<void> {
    if (!validationResult.isValid || uploadInFlightRef.current) {
      return;
    }

    uploadInFlightRef.current = true;
    setIsUploading(true);
    setCreationError(null);
    setUploadUpdates({});

    try {
      await createAndUploadBatch(selectedFiles, (update) => {
        setUploadUpdates((current) => ({
          ...current,
          [update.index]: update,
        }));
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "The batch could not be created.";

      setUploadUpdates({});
      setCreationError(`Batch creation failed: ${message}`);
    } finally {
      uploadInFlightRef.current = false;
      setIsUploading(false);
    }
  }

  return (
    <main className="grid min-h-0 min-w-0 w-full flex-1 grid-rows-[auto_1fr] lg:grid-cols-[280px_minmax(0,1fr)] lg:grid-rows-1 lg:overflow-hidden">
      <DocumentsPanel
        isSelectionLocked={isSelectionLocked}
        result={validationResult}
        uploadUpdates={uploadUpdates}
        onRemove={handleRemove}
      />
      <section
        className="flex min-h-0 min-w-0 flex-col bg-slate-50/30"
        aria-label="Conversation workspace"
      >
        <DocumentSelector
          creationError={creationError}
          fileCount={validationResult.files.length}
          hasUploadStarted={hasUploadStarted}
          inputRef={inputRef}
          isDragging={isDragging}
          isSelectionLocked={isSelectionLocked}
          isUploading={isUploading}
          isValid={validationResult.isValid}
          onChange={handleInputChange}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onOpenPicker={() => inputRef.current?.click()}
          onUpload={handleUpload}
        />
        <DisabledComposer
          hasFiles={validationResult.files.length > 0}
          isUploading={isUploading}
          uploadUpdates={uploadUpdates}
        />
      </section>
    </main>
  );
}
