"use client";

import { useChat } from "@ai-sdk/react";
import {
  ArrowUp,
  FileText,
  LoaderCircle,
  Square,
} from "lucide-react";
import {
  type FormEvent,
  type KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  createDocChatTransport,
  getUIMessageText,
} from "@/lib/chat/client";
import type { ChatSource, DocChatUIMessage } from "@/types/api";
import { RagPipelineVisualizer } from "./rag-pipeline-visualizer";

type ChatWorkspaceProps = {
  batchId: string;
  documentIds: readonly string[];
  isContextUpdating?: boolean;
};

function readStoredMessages(storageKey: string): DocChatUIMessage[] {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(storageKey) ?? "[]");

    if (!Array.isArray(value)) {
      return [];
    }

    return value.filter(
      (item): item is DocChatUIMessage =>
        typeof item === "object" &&
        item !== null &&
        "id" in item &&
        typeof item.id === "string" &&
        "role" in item &&
        (item.role === "user" || item.role === "assistant") &&
        "parts" in item &&
        Array.isArray(item.parts),
    );
  } catch {
    return [];
  }
}

function getMessageSources(message: DocChatUIMessage): ChatSource[] {
  return message.parts.flatMap((part) =>
    part.type === "data-sources" && Array.isArray(part.data)
      ? part.data
      : [],
  );
}

function MessageSources({ sources }: { sources: readonly ChatSource[] }) {
  const label = `${sources.length} ${sources.length === 1 ? "source" : "sources"}`;

  return (
    <details className="group mt-2 w-full overflow-hidden rounded-xl border border-slate-200 bg-white text-left shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <summary className="cursor-pointer list-none px-3 py-2.5 text-xs font-semibold text-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-950 dark:text-slate-200 dark:focus-visible:outline-slate-200">
        <span>{label}</span>
        <span className="float-right font-normal text-slate-500 group-open:hidden dark:text-slate-400">
          Show
        </span>
        <span className="float-right hidden font-normal text-slate-500 group-open:inline dark:text-slate-400">
          Hide
        </span>
      </summary>
      <ol className="space-y-2 border-t border-slate-100 p-2 dark:border-slate-800">
        {sources.map((source, index) => (
          <li
            key={`${source.documentId}-${source.source.label}-${index}`}
            className="rounded-lg bg-slate-50 px-3 py-2.5 dark:bg-slate-950/70"
          >
            <div className="flex min-w-0 items-start justify-between gap-3">
              <p className="min-w-0 break-words text-xs font-semibold text-slate-800 dark:text-slate-200">
                [{index + 1}] {source.filename}
              </p>
              <span className="shrink-0 text-[11px] font-medium text-slate-500 dark:text-slate-400">
                {source.scoreKind === "rrf"
                  ? `Hybrid score ${source.score.toFixed(4)}`
                  : `Similarity ${Math.round(source.score * 100)}%`}
              </span>
            </div>
            <p className="mt-1 text-[11px] font-medium text-slate-500 dark:text-slate-400">
              {source.source.label}
            </p>
            <p className="mt-1.5 whitespace-pre-wrap text-xs leading-5 text-slate-600 dark:text-slate-300">
              {source.excerpt}
            </p>
          </li>
        ))}
      </ol>
    </details>
  );
}

function ConversationMessage({ message }: { message: DocChatUIMessage }) {
  const text = getUIMessageText(message);

  if (!text) {
    return null;
  }

  const isUser = message.role === "user";
  const sources = isUser ? [] : getMessageSources(message);

  return (
    <article
      className={`flex gap-3 ${isUser ? "justify-end" : "justify-start"}`}
      aria-label={isUser ? "Your message" : "DocChat answer"}
    >
      {!isUser ? (
        <span
          className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-xl bg-slate-950 text-white dark:bg-blue-600"
          aria-hidden="true"
        >
          <FileText size={15} strokeWidth={1.8} />
        </span>
      ) : null}
      <div
        className={`flex max-w-[min(42rem,88%)] min-w-0 flex-col ${
          isUser ? "items-end" : "items-start"
        }`}
      >
        <div
          className={`whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-6 ${
            isUser
              ? "rounded-br-md bg-slate-900 text-white dark:bg-blue-600"
              : "rounded-bl-md border border-slate-200 bg-white text-slate-800 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          }`}
        >
          {text}
        </div>
        {sources.length > 0 ? <MessageSources sources={sources} /> : null}
      </div>
    </article>
  );
}

type ActiveChatProps = ChatWorkspaceProps & {
  initialMessages: DocChatUIMessage[];
  storageKey: string;
};

function ActiveChat({
  batchId,
  documentIds,
  initialMessages,
  isContextUpdating = false,
  storageKey,
}: ActiveChatProps) {
  const [input, setInput] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const transport = useMemo(
    () => createDocChatTransport(batchId, documentIds),
    [batchId, documentIds],
  );
  const {
    clearError,
    error,
    messages,
    sendMessage,
    status,
    stop,
  } = useChat<DocChatUIMessage>({
    id: storageKey,
    messages: initialMessages,
    transport,
  });
  const isResponding = status === "submitted" || status === "streaming";
  const canSend =
    input.trim().length > 0 && !isResponding && !isContextUpdating;

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: "end" });
  }, [messages, status]);

  useEffect(() => {
    if (status === "ready" || status === "error") {
      try {
        sessionStorage.setItem(storageKey, JSON.stringify(messages));
      } catch {
        // The chat remains usable when browser storage is unavailable.
      }
    }
  }, [messages, status, storageKey]);

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const message = input.trim();

    if (!message || isResponding || isContextUpdating) {
      return;
    }

    clearError();
    setInput("");
    void sendMessage({ text: message });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-8 sm:py-8"
        aria-live="polite"
      >
        <div
          className={`mx-auto flex w-full flex-col gap-5 ${
            messages.length === 0 ? "max-w-6xl" : "max-w-3xl"
          }`}
        >
          {messages.length === 0 ? (
            <div className="flex min-h-[55vh] items-center justify-center py-2 sm:py-4">
              <RagPipelineVisualizer documentCount={documentIds.length} />
            </div>
          ) : (
            messages.map((message) => (
              <ConversationMessage key={message.id} message={message} />
            ))
          )}

          {isResponding ? (
            <div className="flex items-center gap-2 pl-11 text-sm text-slate-500 dark:text-slate-400">
              <LoaderCircle size={15} className="animate-spin" aria-hidden="true" />
              {status === "submitted"
                ? "Searching your documents…"
                : "Writing the answer…"}
            </div>
          ) : null}
          <div ref={endRef} />
        </div>
      </div>

      <footer className="shrink-0 border-t border-slate-200 bg-white px-3 py-3 dark:border-slate-800 dark:bg-slate-950 sm:px-6 sm:py-4">
        <form className="mx-auto w-full max-w-3xl" onSubmit={handleSubmit}>
          {error ? (
            <div
              className="mb-2 flex items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/60 dark:text-red-300"
              role="alert"
            >
              <span>{error.message || "The answer could not be generated."}</span>
              <button
                type="button"
                onClick={clearError}
                className="shrink-0 font-semibold underline underline-offset-2"
              >
                Dismiss
              </button>
            </div>
          ) : null}
          <div className="relative rounded-2xl border border-slate-300 bg-white shadow-sm focus-within:border-slate-500 focus-within:ring-2 focus-within:ring-slate-200 dark:border-slate-700 dark:bg-slate-900 dark:focus-within:border-blue-500 dark:focus-within:ring-blue-950">
            <label htmlFor="message" className="sr-only">
              Message DocChat
            </label>
            <textarea
              id="message"
              rows={1}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isResponding || isContextUpdating}
              placeholder="Ask a question about your documents"
              className="block min-h-14 max-h-36 w-full resize-none overflow-y-auto bg-transparent py-4 pr-14 pl-4 text-sm text-slate-900 outline-none placeholder:text-slate-400 disabled:cursor-not-allowed dark:text-slate-100 dark:placeholder:text-slate-500"
            />
            {isResponding ? (
              <button
                type="button"
                onClick={() => void stop()}
                aria-label="Stop response"
                className="absolute right-2.5 bottom-2.5 grid size-9 place-items-center rounded-xl bg-slate-900 text-white hover:bg-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-950 dark:bg-blue-600 dark:hover:bg-blue-500 dark:focus-visible:outline-slate-200"
              >
                <Square size={13} fill="currentColor" aria-hidden="true" />
              </button>
            ) : (
              <button
                type="submit"
                disabled={!canSend}
                aria-label="Send message"
                className="absolute right-2.5 bottom-2.5 grid size-9 place-items-center rounded-xl bg-slate-950 text-white hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-950 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 dark:bg-blue-600 dark:hover:bg-blue-500 dark:focus-visible:outline-slate-200 dark:disabled:bg-slate-800 dark:disabled:text-slate-500"
              >
                <ArrowUp size={17} strokeWidth={2} aria-hidden="true" />
              </button>
            )}
          </div>
          {isContextUpdating ? (
            <p
              className="mt-2 flex items-center justify-center gap-1.5 text-center text-xs font-medium leading-5 text-blue-700 dark:text-blue-300"
              role="status"
            >
              <LoaderCircle size={13} className="animate-spin" aria-hidden="true" />
              Updating document context…
            </p>
          ) : (
            <p className="mt-2 text-center text-xs leading-5 text-slate-500 dark:text-slate-400">
              Answers use {documentIds.length} ready {documentIds.length === 1 ? "document" : "documents"}. Shift + Enter adds a line.
            </p>
          )}
        </form>
      </footer>
    </div>
  );
}

export function ChatWorkspace({
  batchId,
  documentIds,
  isContextUpdating,
}: ChatWorkspaceProps) {
  const storageKey = `docchat:chat:${batchId}:${[...documentIds].sort().join(",")}`;
  const [initialMessages] = useState(() => readStoredMessages(storageKey));

  return (
    <ActiveChat
      batchId={batchId}
      documentIds={documentIds}
      initialMessages={initialMessages}
      isContextUpdating={isContextUpdating}
      storageKey={storageKey}
    />
  );
}
