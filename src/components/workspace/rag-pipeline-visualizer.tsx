import Image from "next/image";
import type { CSSProperties } from "react";

import { GEMINI_CHAT_MODEL } from "@/lib/ai/model-config";

type PipelineStage = {
  detail: string;
  key: "upload" | "validate" | "extract" | "chunk" | "embed" | "index";
  label: string;
  number: string;
};

const pipelineStages: readonly PipelineStage[] = [
  { key: "upload", number: "01", label: "Upload", detail: "Secure transfer" },
  { key: "validate", number: "02", label: "Validate", detail: "Format checks" },
  { key: "extract", number: "03", label: "Extract", detail: "Readable text" },
  { key: "chunk", number: "04", label: "Chunk", detail: "Knowledge blocks" },
  { key: "embed", number: "05", label: "Embed", detail: "Meaning encoded" },
  { key: "index", number: "06", label: "Index", detail: "Vectors searchable" },
];

type RagPipelineMode = "processing" | "ready" | "waiting";

const numberFormatter = new Intl.NumberFormat("en-US");

function GeminiPoweredBadge() {
  const inputTokens = numberFormatter.format(
    GEMINI_CHAT_MODEL.inputTokenLimit,
  );
  const outputTokens = numberFormatter.format(
    GEMINI_CHAT_MODEL.outputTokenLimit,
  );

  return (
    <div
      className="inline-flex max-w-full flex-wrap items-center justify-center gap-x-3 gap-y-2 rounded-2xl border border-slate-200/90 bg-white/85 px-3.5 py-2 text-left shadow-sm backdrop-blur-md dark:border-slate-700/80 dark:bg-slate-950/75"
      aria-label={`Powered by ${GEMINI_CHAT_MODEL.displayName}. ${inputTokens} input tokens, ${outputTokens} output tokens, ${GEMINI_CHAT_MODEL.thinkingLevel} reasoning.`}
    >
      <Image
        src="/gemini-spark-logo.png"
        alt=""
        width={560}
        height={560}
        className="size-7 shrink-0"
      />

      <div className="min-w-0">
        <p className="text-[9px] font-bold tracking-[0.16em] text-slate-500 uppercase dark:text-slate-400">
          Powered by Gemini
        </p>
        <p className="text-xs font-semibold text-slate-900 dark:text-white">
          {GEMINI_CHAT_MODEL.displayName}
        </p>
      </div>

      <span
        className="hidden h-7 w-px bg-slate-200 dark:bg-slate-700 sm:block"
        aria-hidden="true"
      />
      <div className="flex flex-wrap justify-center gap-1.5 text-[10px] font-medium text-slate-600 dark:text-slate-300">
        <span className="rounded-full bg-slate-100 px-2 py-1 dark:bg-slate-800">
          1M context
        </span>
        <span className="rounded-full bg-slate-100 px-2 py-1 dark:bg-slate-800">
          65K output
        </span>
        <span className="rounded-full bg-slate-100 px-2 py-1 capitalize dark:bg-slate-800">
          {GEMINI_CHAT_MODEL.thinkingLevel} reasoning
        </span>
      </div>
    </div>
  );
}

function StageVisual({ stage }: { stage: PipelineStage["key"] }) {
  if (stage === "upload") {
    return (
      <div className="rag-upload-visual" aria-hidden="true">
        <span className="rag-upload-sheet rag-upload-sheet-back" />
        <span className="rag-upload-sheet rag-upload-sheet-middle" />
        <span className="rag-upload-sheet rag-upload-sheet-front">
          <span />
          <span />
          <span />
        </span>
        <span className="rag-upload-arrow">↑</span>
      </div>
    );
  }

  if (stage === "validate") {
    return (
      <div className="rag-validate-visual" aria-hidden="true">
        <span className="rag-validate-ring" />
        <span className="rag-validate-check">✓</span>
        <span className="rag-validate-scan" />
      </div>
    );
  }

  if (stage === "extract") {
    return (
      <div className="rag-extract-visual" aria-hidden="true">
        {Array.from({ length: 5 }, (_, index) => (
          <span
            className="rag-extract-line"
            key={index}
            style={{ "--rag-line": index } as CSSProperties}
          />
        ))}
        <span className="rag-extract-cursor" />
      </div>
    );
  }

  if (stage === "chunk") {
    return (
      <div className="rag-chunk-visual" aria-hidden="true">
        {Array.from({ length: 6 }, (_, index) => (
          <span
            className="rag-chunk-block"
            key={index}
            style={{ "--rag-cell": index } as CSSProperties}
          />
        ))}
      </div>
    );
  }

  if (stage === "embed") {
    return (
      <div className="rag-embed-visual" aria-hidden="true">
        {Array.from({ length: 12 }, (_, index) => (
          <span
            className="rag-embed-value"
            data-vector-value=""
            key={index}
            style={{ "--rag-value": index } as CSSProperties}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="rag-index-visual" aria-hidden="true">
      <span className="rag-index-orbit rag-index-orbit-outer" />
      <span className="rag-index-orbit rag-index-orbit-inner" />
      <span className="rag-index-core" />
      {Array.from({ length: 6 }, (_, index) => (
        <span
          className="rag-index-point"
          data-vector-point=""
          key={index}
          style={{ "--rag-point": index } as CSSProperties}
        />
      ))}
    </div>
  );
}

export function RagPipelineVisualizer({
  documentCount,
  mode = "ready",
}: {
  documentCount: number;
  mode?: RagPipelineMode;
}) {
  const content =
    mode === "ready"
      ? {
          heading: "Your documents are ready",
          description: `See how ${documentCount} ready ${
            documentCount === 1 ? "document becomes" : "documents become"
          } searchable knowledge before your first question.`,
          footer: "Vector context ready for grounded answers",
        }
      : mode === "processing"
        ? {
            heading: "Building your document context",
            description: `${documentCount} ${
              documentCount === 1 ? "document is" : "documents are"
            } moving through extraction, chunking, embeddings and vector indexing.`,
            footer: "Processing securely in your private workspace",
          }
        : {
            heading: "From files to searchable knowledge",
            description:
              "Your documents become reliable knowledge, ready to answer your questions.",
            footer: null,
          };

  return (
    <section
      className="rag-pipeline-shell relative flex min-h-0 w-full flex-1 items-center justify-center overflow-hidden px-4 py-8 text-center sm:px-6 sm:py-10 lg:px-8"
      aria-labelledby="rag-pipeline-heading"
      data-testid="rag-pipeline-visualizer"
    >
      <div className="rag-ambient-orb rag-ambient-orb-left" aria-hidden="true" />
      <div className="rag-ambient-orb rag-ambient-orb-right" aria-hidden="true" />
      <div className="absolute top-5 left-1/2 z-20 w-full -translate-x-1/2 px-4 sm:top-6">
        <GeminiPoweredBadge />
      </div>

      <div className="relative z-10 w-full max-w-6xl">
        <h1
          id="rag-pipeline-heading"
          className="mt-0 text-2xl font-semibold tracking-tight text-slate-950 dark:text-white sm:text-3xl"
        >
          {content.heading}
        </h1>
        <p className="mx-auto mt-2 max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-400">
          {content.description}
        </p>

        <div className="relative mx-auto mt-7 max-w-6xl sm:mt-9">
          <div className="rag-flow-track hidden lg:block" aria-hidden="true">
            <span className="rag-flow-particle rag-flow-particle-one" />
            <span className="rag-flow-particle rag-flow-particle-two" />
            <span className="rag-flow-particle rag-flow-particle-three" />
          </div>

          <ol
            className="relative grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6 lg:gap-2.5"
            aria-label="Document processing pipeline"
          >
            {pipelineStages.map((stage, index) => (
              <li
                className="rag-pipeline-stage relative min-w-0 rounded-2xl border border-slate-200/90 bg-white/95 px-2.5 py-3 shadow-sm dark:border-slate-700/80 dark:bg-slate-950/85 sm:px-3 sm:py-4"
                data-rag-stage={stage.key}
                key={stage.key}
                style={{ "--rag-step": index } as CSSProperties}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[9px] font-bold tracking-[0.18em] text-slate-400 dark:text-slate-500">
                    {stage.number}
                  </span>
                  <span className="rag-stage-status size-1.5 rounded-full bg-slate-300 dark:bg-slate-700" />
                </div>
                <div className="rag-stage-visual mx-auto mt-2 grid h-20 place-items-center text-blue-600 dark:text-blue-400">
                  <StageVisual stage={stage.key} />
                </div>
                <p className="mt-2 text-xs font-bold text-slate-800 dark:text-slate-100">
                  {stage.label}
                </p>
                <p className="mt-0.5 truncate text-[10px] text-slate-500 dark:text-slate-400">
                  {stage.detail}
                </p>
              </li>
            ))}
          </ol>
        </div>

        {content.footer ? (
          <div
            className={`mx-auto mt-6 flex w-fit max-w-full items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold ${
              mode === "ready"
                ? "border border-emerald-200 bg-emerald-50/90 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-300"
                : "border border-blue-200 bg-blue-50/90 text-blue-700 dark:border-blue-900 dark:bg-blue-950/60 dark:text-blue-300"
            }`}
          >
            <span
              className={`relative size-2 shrink-0 rounded-full ${
                mode === "ready" ? "rag-ready-pulse bg-emerald-500" : "rag-replay-dot bg-blue-500"
              }`}
              aria-hidden="true"
            />
            <span>{content.footer}</span>
          </div>
        ) : null}
      </div>
    </section>
  );
}
