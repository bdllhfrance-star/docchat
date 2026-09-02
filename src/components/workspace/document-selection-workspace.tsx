"use client";

import {
  AlertCircle,
  ArrowUp,
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

type DocumentsPanelProps = {
  onRemove: (index: number) => void;
  result: SelectionResult;
};

function DocumentsPanel({ onRemove, result }: DocumentsPanelProps) {
  const hasFiles = result.files.length > 0;

  return (
    <aside
      className="border-b border-slate-200 bg-slate-50/70 lg:flex lg:min-h-0 lg:flex-col lg:overflow-hidden lg:border-r lg:border-b-0"
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
              const hasError = errors.length > 0;

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
                      className="grid size-8 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-950"
                      aria-label={`Remove ${file.name}`}
                    >
                      <Trash2 size={15} aria-hidden="true" />
                    </button>
                  </div>

                  {hasError ? (
                    <div className="mt-2 border-t border-red-100 pt-2 text-xs leading-5 text-red-700">
                      {errors.map((error) => (
                        <p key={error}>{fileErrorMessages[error]}</p>
                      ))}
                    </div>
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
  fileCount: number;
  inputRef: React.RefObject<HTMLInputElement | null>;
  isDragging: boolean;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onDragEnter: (event: DragEvent<HTMLDivElement>) => void;
  onDragLeave: (event: DragEvent<HTMLDivElement>) => void;
  onDragOver: (event: DragEvent<HTMLDivElement>) => void;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
  onOpenPicker: () => void;
};

function DocumentSelector({
  fileCount,
  inputRef,
  isDragging,
  onChange,
  onDragEnter,
  onDragLeave,
  onDragOver,
  onDrop,
  onOpenPicker,
}: DocumentSelectorProps) {
  const hasFiles = fileCount > 0;

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
          className="sr-only"
          aria-label="Select documents from device"
        />
        <button
          type="button"
          onClick={onOpenPicker}
          className="mt-5 inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-950"
        >
          <Plus size={16} aria-hidden="true" />
          {hasFiles ? "Replace selection" : "Choose documents"}
        </button>
        <p className="mt-4 text-xs leading-5 text-slate-400">
          {supportedFormats} · 10 MiB per file · 50 MiB per batch
        </p>
      </div>

      {hasFiles ? (
        <p
          className="mt-4 text-xs leading-5 text-slate-500"
          aria-live="polite"
        >
          Files are selected locally and have not been uploaded.
        </p>
      ) : null}
    </section>
  );
}

function DisabledComposer({ hasFiles }: { hasFiles: boolean }) {
  const reason = hasFiles
    ? "Selected documents must be uploaded and fully processed before chatting."
    : "Add and process at least one document to start chatting.";

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
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const validationResult = useMemo(
    () => validateBatchFiles(selectedFiles),
    [selectedFiles],
  );

  function replaceSelection(files: FileList | readonly File[]): void {
    setSelectedFiles(Array.from(files));
  }

  function handleInputChange(event: ChangeEvent<HTMLInputElement>): void {
    replaceSelection(event.target.files ?? []);
    event.target.value = "";
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setIsDragging(true);
  }

  function handleDragEnter(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault();
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
    setIsDragging(false);

    if (event.dataTransfer.files.length === 0) {
      return;
    }

    replaceSelection(event.dataTransfer.files);
  }

  function handleRemove(indexToRemove: number): void {
    setSelectedFiles((files) =>
      files.filter((_, index) => index !== indexToRemove),
    );
  }

  return (
    <main className="grid min-h-0 flex-1 grid-rows-[auto_1fr] lg:grid-cols-[280px_minmax(0,1fr)] lg:grid-rows-1 lg:overflow-hidden">
      <DocumentsPanel result={validationResult} onRemove={handleRemove} />
      <section
        className="flex min-h-0 min-w-0 flex-col bg-slate-50/30"
        aria-label="Conversation workspace"
      >
        <DocumentSelector
          fileCount={validationResult.files.length}
          inputRef={inputRef}
          isDragging={isDragging}
          onChange={handleInputChange}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onOpenPicker={() => inputRef.current?.click()}
        />
        <DisabledComposer hasFiles={validationResult.files.length > 0} />
      </section>
    </main>
  );
}
