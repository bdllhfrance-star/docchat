"use client";

import { useChat } from "@ai-sdk/react";
import Image from "next/image";
import {
  ArrowUp,
  ExternalLink,
  FileText,
  LoaderCircle,
  Square,
  X,
} from "lucide-react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { createPortal } from "react-dom";
import {
  type FormEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  createDocChatTransport,
  getUIMessageText,
} from "@/lib/chat/client";
import {
  extractGeneralAiRedirect,
  GENERAL_AI_DESTINATIONS,
  linkTrustedGeneralAiNames,
} from "@/lib/chat/general-ai-redirect";
import { classifyChatTurn, type ChatTurnMode } from "@/lib/chat/turn-mode";
import type { ChatSource, DocChatUIMessage } from "@/types/api";
import { RagPipelineVisualizer } from "./rag-pipeline-visualizer";

type ChatWorkspaceProps = {
  batchId: string;
  documentIds: readonly string[];
  isContextUpdating?: boolean;
};

const COMPOSER_MIN_HEIGHT = 56;
const COMPOSER_MAX_HEIGHT = 108;

function resizeComposer(element: HTMLTextAreaElement): void {
  element.style.height = "0px";
  const contentHeight = element.scrollHeight;
  const height = Math.min(
    COMPOSER_MAX_HEIGHT,
    Math.max(COMPOSER_MIN_HEIGHT, contentHeight),
  );

  element.style.height = `${height}px`;
  element.style.overflowY =
    contentHeight > COMPOSER_MAX_HEIGHT ? "auto" : "hidden";
}

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

const destinationDotClasses = {
  chatgpt: "bg-emerald-500",
  claude: "bg-orange-500",
  gemini: "bg-gradient-to-br from-blue-500 via-violet-500 to-fuchsia-500",
} as const;

function GeneralAiDestinations() {
  return (
    <nav
      aria-label="Continue with a general AI assistant"
      className="mt-5 flex flex-wrap items-center gap-2 border-t border-slate-200/80 pt-4 dark:border-slate-800"
    >
      <span className="mr-1 text-xs font-medium tracking-wide text-slate-500 dark:text-slate-400">
        Continue with
      </span>
      {GENERAL_AI_DESTINATIONS.map((destination) => (
        <a
          key={destination.id}
          href={destination.href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Open ${destination.label} in a new tab`}
          className="group inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold leading-none text-slate-800 no-underline shadow-sm transition duration-200 hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:border-blue-600"
        >
          <span
            aria-hidden="true"
            className={`h-2.5 w-2.5 rounded-full ${destinationDotClasses[destination.id]}`}
          />
          {destination.label}
          <ExternalLink
            aria-hidden="true"
            className="h-3.5 w-3.5 text-slate-400 transition group-hover:text-blue-600 dark:group-hover:text-blue-400"
            strokeWidth={1.8}
          />
        </a>
      ))}
    </nav>
  );
}

function linkDocumentCitations(markdown: string, sourceCount: number): string {
  return markdown
    .split(/(```[\s\S]*?```|~~~[\s\S]*?~~~)/gu)
    .map((block, blockIndex) => {
      if (blockIndex % 2 === 1) {
        return block;
      }

      return block
        .split(/(`[^`\n]*`)/gu)
        .map((part, partIndex) => {
          if (partIndex % 2 === 1) {
            return part;
          }

          return part.replace(/\[(\d+)\](?!\s*\()/gu, (match, value) => {
            const sourceNumber = Number(value);

            return sourceNumber >= 1 && sourceNumber <= sourceCount
              ? `[${sourceNumber}](#docchat-source-${sourceNumber})`
              : match;
          });
        })
        .join("");
    })
    .join("");
}

type CitationPopoverPosition = {
  left: number;
  placement: "above" | "below";
  top: number;
  width: number;
};

type ActiveCitation = {
  id: string;
  position: CitationPopoverPosition;
  sourceNumber: number;
};

function getCitationPopoverPosition(
  anchor: HTMLButtonElement,
): CitationPopoverPosition {
  const viewportPadding = 16;
  const gap = 8;
  const expectedHeight = 190;
  const rect = anchor.getBoundingClientRect();
  const width = Math.min(352, window.innerWidth - viewportPadding * 2);
  const left = Math.min(
    window.innerWidth - width - viewportPadding,
    Math.max(viewportPadding, rect.left),
  );
  const spaceBelow = window.innerHeight - rect.bottom;
  const placement =
    spaceBelow < expectedHeight && rect.top > spaceBelow ? "above" : "below";

  return {
    left,
    placement,
    top: placement === "above" ? rect.top - gap : rect.bottom + gap,
    width,
  };
}

function SourcePreview({
  number,
  onClose,
  position,
  source,
}: {
  number: number;
  onClose: () => void;
  position: CitationPopoverPosition;
  source: ChatSource;
}) {
  const previewRef = useRef<HTMLElement>(null);

  useEffect(() => {
    function closeOnEscape(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    function closeOnScroll(event: Event) {
      const target = event.target;

      if (target instanceof Node && previewRef.current?.contains(target)) {
        return;
      }

      onClose();
    }

    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener("resize", onClose);
    window.addEventListener("scroll", closeOnScroll, true);

    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("scroll", closeOnScroll, true);
    };
  }, [onClose]);

  return createPortal(
    <>
      <button
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        onClick={onClose}
        className="fixed inset-0 z-40 cursor-default bg-transparent"
      />
      <aside
        ref={previewRef}
        className="fixed z-50 max-h-[min(16rem,calc(100vh-2rem))] overflow-y-auto rounded-xl border border-blue-200/80 bg-white/95 px-3.5 py-3 text-sm shadow-[0_18px_50px_-18px_rgba(15,23,42,0.5)] backdrop-blur-xl dark:border-blue-900/80 dark:bg-slate-900/95"
        aria-label={`Source ${number} details`}
        data-placement={position.placement}
        style={{
          left: position.left,
          top: position.top,
          width: position.width,
          transform:
            position.placement === "above" ? "translateY(-100%)" : undefined,
        }}
      >
        <div className="flex items-start gap-2.5">
          <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300">
            <FileText size={14} aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="break-words font-semibold text-slate-900 dark:text-slate-100">
              [{number}] {source.filename}
            </p>
            <p className="mt-0.5 text-xs font-medium text-blue-700 dark:text-blue-300">
              {source.source.label}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close source details"
            className="grid size-7 shrink-0 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>
        <p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-slate-600 dark:text-slate-300">
          {source.excerpt}
        </p>
      </aside>
    </>,
    document.body,
  );
}

function ThinkingIndicator({
  mode,
  status,
}: {
  mode: ChatTurnMode;
  status: "submitted" | "streaming";
}) {
  const label =
    status === "streaming"
      ? "Writing the answer…"
      : mode === "grounded"
        ? "Searching your documents…"
        : "Responding…";

  return (
    <div
      className="flex items-center gap-3 text-sm font-medium text-slate-600 dark:text-slate-300"
      role="status"
      aria-label={label}
      data-testid="thinking-indicator"
    >
      <span className="smartly-thinking-mark relative grid size-9 shrink-0 place-items-center" aria-hidden="true">
        <span className="smartly-thinking-halo absolute inset-0 rounded-full border border-blue-400/40" />
        <Image
          src="/smartly-ai-mark.png"
          alt=""
          width={87}
          height={80}
          className="smartly-thinking-logo relative h-6 w-auto"
        />
      </span>
      <span className="smartly-thinking-label">{label}</span>
    </div>
  );
}

function ConversationMessage({ message }: { message: DocChatUIMessage }) {
  const text = useMemo(() => getUIMessageText(message), [message]);
  const [activeCitation, setActiveCitation] = useState<ActiveCitation | null>(
    null,
  );
  const isUser = message.role === "user";
  const presentation = useMemo(
    () =>
      isUser
        ? { text, showDestinations: false }
        : extractGeneralAiRedirect(text),
    [isUser, text],
  );
  const sources = useMemo(
    () => (isUser ? [] : getMessageSources(message)),
    [isUser, message],
  );
  const renderedText = useMemo(
    () => {
      if (isUser) {
        return presentation.text;
      }

      const textWithCitations = linkDocumentCitations(
        presentation.text,
        sources.length,
      );

      return presentation.showDestinations
        ? linkTrustedGeneralAiNames(textWithCitations)
        : textWithCitations;
    },
    [isUser, presentation.showDestinations, presentation.text, sources.length],
  );
  const activeSource =
    activeCitation === null
      ? undefined
      : sources[activeCitation.sourceNumber - 1];
  const closeCitation = useCallback(() => setActiveCitation(null), []);
  const markdownComponents = useMemo<Components>(() => ({
    a({ children, href, node, ...props }) {
      const citationMatch = href?.match(/^#docchat-source-(\d+)$/u);

      if (citationMatch) {
        const sourceNumber = Number(citationMatch[1]);
        const source = sources[sourceNumber - 1];
        const citationId = `${sourceNumber}:${node?.position?.start.offset ?? 0}`;

        if (!source) {
          return <>{children}</>;
        }

        return (
          <button
            type="button"
            onClick={(event) => {
              const position = getCitationPopoverPosition(event.currentTarget);

              setActiveCitation((current) =>
                current?.id === citationId
                  ? null
                  : {
                      id: citationId,
                      position,
                      sourceNumber,
                    },
              );
            }}
            aria-haspopup="dialog"
            aria-label={`Open source ${sourceNumber}: ${source.filename}, ${source.source.label}`}
            className="mx-0.5 inline-flex translate-y-[-1px] items-center rounded-md border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[0.72em] font-semibold leading-none text-blue-700 no-underline transition-colors hover:border-blue-300 hover:bg-blue-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-300 dark:hover:border-blue-700 dark:hover:bg-blue-900"
          >
            [{sourceNumber}]
          </button>
        );
      }

      return (
        <a
          {...props}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-blue-700 underline decoration-blue-300 underline-offset-2 hover:text-blue-900 dark:text-blue-300 dark:hover:text-blue-200"
        >
          {children}
        </a>
      );
    },
    blockquote({ children }) {
      return (
        <blockquote className="my-4 border-l-2 border-blue-300 pl-4 text-slate-600 dark:border-blue-700 dark:text-slate-300">
          {children}
        </blockquote>
      );
    },
    code({ children, className, node: _node, ...props }) {
      void _node;
      return (
        <code
          {...props}
          className={`${className ?? ""} rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[0.9em] text-slate-900 dark:bg-slate-800 dark:text-slate-100`}
        >
          {children}
        </code>
      );
    },
    h1({ children }) {
      return (
        <h1 className="mt-6 mb-3 text-xl font-semibold first:mt-0">
          {children}
        </h1>
      );
    },
    h2({ children }) {
      return (
        <h2 className="mt-6 mb-3 text-lg font-semibold first:mt-0">
          {children}
        </h2>
      );
    },
    h3({ children }) {
      return (
        <h3 className="mt-5 mb-2 text-base font-semibold first:mt-0">
          {children}
        </h3>
      );
    },
    hr() {
      return <hr className="my-5 border-slate-200 dark:border-slate-700" />;
    },
    img({ alt }) {
      return (
        <span className="text-slate-500">
          [Image: {alt || "document image"}]
        </span>
      );
    },
    li({ children }) {
      return <li className="pl-1">{children}</li>;
    },
    ol({ children }) {
      return (
        <ol className="my-3 list-decimal space-y-1.5 pl-6">{children}</ol>
      );
    },
    p({ children }) {
      return <p className="mb-3 last:mb-0">{children}</p>;
    },
    pre({ children }) {
      return (
        <pre className="my-4 overflow-x-auto rounded-xl bg-slate-950 p-4 text-sm leading-6 text-slate-100 [&>code]:bg-transparent [&>code]:p-0 [&>code]:text-inherit">
          {children}
        </pre>
      );
    },
    table({ children }) {
      return (
        <table className="my-4 block max-w-full overflow-x-auto border-collapse text-left text-sm">
          {children}
        </table>
      );
    },
    td({ children }) {
      return (
        <td className="border border-slate-200 px-3 py-2 dark:border-slate-700">
          {children}
        </td>
      );
    },
    th({ children }) {
      return (
        <th className="border border-slate-200 bg-slate-100 px-3 py-2 font-semibold dark:border-slate-700 dark:bg-slate-800">
          {children}
        </th>
      );
    },
    ul({ children }) {
      return <ul className="my-3 list-disc space-y-1.5 pl-6">{children}</ul>;
    },
  }), [sources]);
  const markdownContent = useMemo(
    () => (
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={markdownComponents}
      >
        {renderedText}
      </ReactMarkdown>
    ),
    [markdownComponents, renderedText],
  );

  if (!text) {
    return null;
  }

  return (
    <article
      className={`flex gap-3 ${isUser ? "justify-end" : "justify-start"}`}
      aria-label={isUser ? "Your message" : "DocChat answer"}
    >
      <div
        className={`flex min-w-0 flex-col ${
          isUser ? "max-w-[min(42rem,88%)] items-end" : "w-full items-start"
        }`}
      >
        {isUser ? (
          <div className="whitespace-pre-wrap rounded-2xl rounded-br-md bg-slate-900 px-4 py-3 text-sm leading-6 text-white dark:bg-blue-600">
            {text}
          </div>
        ) : (
          <div
            className="w-full text-[15px] leading-7 text-slate-800 dark:text-slate-100"
            data-assistant-content
          >
            {markdownContent}
            {presentation.showDestinations ? <GeneralAiDestinations /> : null}
            {activeSource && activeCitation ? (
              <SourcePreview
                number={activeCitation.sourceNumber}
                source={activeSource}
                position={activeCitation.position}
                onClose={closeCitation}
              />
            ) : null}
          </div>
        )}
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
  const [submittedMode, setSubmittedMode] = useState<ChatTurnMode>("grounded");
  const composerRef = useRef<HTMLTextAreaElement>(null);
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
    setSubmittedMode(
      classifyChatTurn(message, { hasHistory: messages.length > 0 }),
    );
    setInput("");
    if (composerRef.current) {
      composerRef.current.style.height = `${COMPOSER_MIN_HEIGHT}px`;
      composerRef.current.style.overflowY = "hidden";
    }
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
    <div className="flex min-h-0 flex-1 flex-col bg-transparent">
      <div
        className={`min-h-0 flex-1 overflow-y-auto ${
          messages.length === 0 ? "flex" : "px-4 py-6 sm:px-8 sm:py-8"
        }`}
        aria-live="polite"
      >
        <div
          className={`flex w-full flex-col gap-5 ${
            messages.length === 0
              ? "min-h-full flex-1"
              : "mx-auto max-w-3xl"
          }`}
        >
          {messages.length === 0 ? (
            <div className="flex min-h-[55vh] flex-1 items-stretch">
              <RagPipelineVisualizer documentCount={documentIds.length} />
            </div>
          ) : (
            messages.map((message) => (
              <ConversationMessage key={message.id} message={message} />
            ))
          )}

          {isResponding ? (
            <ThinkingIndicator mode={submittedMode} status={status} />
          ) : null}
          <div ref={endRef} />
        </div>
      </div>

      <footer className="shrink-0 bg-transparent px-3 pt-2 pb-3 sm:px-6 sm:pt-3 sm:pb-4">
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
          <div className="flex items-end overflow-hidden rounded-2xl border border-white/80 bg-white/85 shadow-[0_12px_35px_-20px_rgba(15,23,42,0.5)] backdrop-blur-xl focus-within:border-slate-500 focus-within:ring-2 focus-within:ring-slate-200 dark:border-slate-700/80 dark:bg-slate-900/85 dark:focus-within:border-blue-500 dark:focus-within:ring-blue-950">
            <label htmlFor="message" className="sr-only">
              Message DocChat
            </label>
            <textarea
              ref={composerRef}
              id="message"
              rows={1}
              value={input}
              onChange={(event) => {
                setInput(event.target.value);
                resizeComposer(event.currentTarget);
              }}
              onKeyDown={handleKeyDown}
              disabled={isResponding || isContextUpdating}
              placeholder="Ask a question about your documents"
              className="chat-composer-textarea block h-14 min-h-14 max-h-[108px] min-w-0 flex-1 resize-none overflow-y-hidden bg-transparent py-[18px] pr-2 pl-4 text-sm leading-5 text-slate-900 outline-none placeholder:text-slate-400 disabled:cursor-not-allowed dark:text-slate-100 dark:placeholder:text-slate-500"
            />
            {isResponding ? (
              <button
                type="button"
                onClick={() => void stop()}
                aria-label="Stop response"
                className="m-2.5 ml-0 grid size-9 shrink-0 place-items-center rounded-xl bg-slate-900 text-white hover:bg-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-950 dark:bg-blue-600 dark:hover:bg-blue-500 dark:focus-visible:outline-slate-200"
              >
                <Square size={13} fill="currentColor" aria-hidden="true" />
              </button>
            ) : (
              <button
                type="submit"
                disabled={!canSend}
                aria-label="Send message"
                className="m-2.5 ml-0 grid size-9 shrink-0 place-items-center rounded-xl bg-slate-950 text-white hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-950 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 dark:bg-blue-600 dark:hover:bg-blue-500 dark:focus-visible:outline-slate-200 dark:disabled:bg-slate-800 dark:disabled:text-slate-500"
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
