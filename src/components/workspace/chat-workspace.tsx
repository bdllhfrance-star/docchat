"use client";

import { useChat } from "@ai-sdk/react";
import {
  ArrowUp,
  FileText,
  LoaderCircle,
  MessageSquareText,
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

type ChatWorkspaceProps = {
  batchId: string;
  documentIds: readonly string[];
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
    <details className="group mt-2 w-full overflow-hidden rounded-xl border border-slate-200 bg-white text-left shadow-sm">
      <summary className="cursor-pointer list-none px-3 py-2.5 text-xs font-semibold text-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-950">
        <span>{label}</span>
        <span className="float-right font-normal text-slate-500 group-open:hidden">
          Show
        </span>
        <span className="float-right hidden font-normal text-slate-500 group-open:inline">
          Hide
        </span>
      </summary>
      <ol className="space-y-2 border-t border-slate-100 p-2">
        {sources.map((source, index) => (
          <li
            key={`${source.documentId}-${source.source.label}-${index}`}
            className="rounded-lg bg-slate-50 px-3 py-2.5"
          >
            <div className="flex min-w-0 items-start justify-between gap-3">
              <p className="min-w-0 break-words text-xs font-semibold text-slate-800">
                [{index + 1}] {source.filename}
              </p>
              <span className="shrink-0 text-[11px] font-medium text-slate-500">
                Similarity {Math.round(source.score * 100)}%
              </span>
            </div>
            <p className="mt-1 text-[11px] font-medium text-slate-500">
              {source.source.label}
            </p>
            <p className="mt-1.5 whitespace-pre-wrap text-xs leading-5 text-slate-600">
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
          className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-xl bg-slate-950 text-white"
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
              ? "rounded-br-md bg-slate-900 text-white"
              : "rounded-bl-md border border-slate-200 bg-white text-slate-800 shadow-sm"
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
  const canSend = input.trim().length > 0 && !isResponding;

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

    if (!message || isResponding) {
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
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
          {messages.length === 0 ? (
            <div className="flex min-h-[45vh] flex-col items-center justify-center text-center">
              <span className="grid size-12 place-items-center rounded-2xl border border-emerald-200 bg-emerald-50 text-emerald-700">
                <MessageSquareText size={22} strokeWidth={1.8} aria-hidden="true" />
              </span>
              <h1 className="mt-5 text-2xl font-semibold tracking-tight text-slate-950">
                Your documents are ready
              </h1>
              <p className="mt-2 max-w-md text-sm leading-6 text-slate-600">
                Ask a question and DocChat will answer from the processed
                documents only.
              </p>
            </div>
          ) : (
            messages.map((message) => (
              <ConversationMessage key={message.id} message={message} />
            ))
          )}

          {isResponding ? (
            <div className="flex items-center gap-2 pl-11 text-sm text-slate-500">
              <LoaderCircle size={15} className="animate-spin" aria-hidden="true" />
              {status === "submitted"
                ? "Searching your documents…"
                : "Writing the answer…"}
            </div>
          ) : null}
          <div ref={endRef} />
        </div>
      </div>

      <footer className="shrink-0 border-t border-slate-200 bg-white px-3 py-3 sm:px-6 sm:py-4">
        <form className="mx-auto w-full max-w-3xl" onSubmit={handleSubmit}>
          {error ? (
            <div
              className="mb-2 flex items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
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
          <div className="relative rounded-2xl border border-slate-300 bg-white shadow-sm focus-within:border-slate-500 focus-within:ring-2 focus-within:ring-slate-200">
            <label htmlFor="message" className="sr-only">
              Message DocChat
            </label>
            <textarea
              id="message"
              rows={1}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isResponding}
              placeholder="Ask a question about your documents"
              className="block min-h-14 max-h-36 w-full resize-none overflow-y-auto bg-transparent py-4 pr-14 pl-4 text-sm text-slate-900 outline-none placeholder:text-slate-400 disabled:cursor-not-allowed"
            />
            {isResponding ? (
              <button
                type="button"
                onClick={() => void stop()}
                aria-label="Stop response"
                className="absolute right-2.5 bottom-2.5 grid size-9 place-items-center rounded-xl bg-slate-900 text-white hover:bg-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-950"
              >
                <Square size={13} fill="currentColor" aria-hidden="true" />
              </button>
            ) : (
              <button
                type="submit"
                disabled={!canSend}
                aria-label="Send message"
                className="absolute right-2.5 bottom-2.5 grid size-9 place-items-center rounded-xl bg-slate-950 text-white hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-950 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
              >
                <ArrowUp size={17} strokeWidth={2} aria-hidden="true" />
              </button>
            )}
          </div>
          <p className="mt-2 text-center text-xs leading-5 text-slate-500">
            Answers use {documentIds.length} ready {documentIds.length === 1 ? "document" : "documents"}. Shift + Enter adds a line.
          </p>
        </form>
      </footer>
    </div>
  );
}

export function ChatWorkspace({ batchId, documentIds }: ChatWorkspaceProps) {
  const storageKey = `docchat:chat:${batchId}`;
  const [initialMessages] = useState(() => readStoredMessages(storageKey));

  return (
    <ActiveChat
      batchId={batchId}
      documentIds={documentIds}
      initialMessages={initialMessages}
      storageKey={storageKey}
    />
  );
}
