import { google } from "@ai-sdk/google";
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  type ModelMessage,
  streamText,
} from "ai";

import { GEMINI_CHAT_MODEL } from "@/lib/ai/model-config";
import {
  CHAT_SYSTEM_PROMPT,
  type GroundedChatContext,
} from "@/lib/chat/grounding";
import { getLocalChatResponse } from "@/lib/chat/local-response";
import { getChatStreamFailure } from "@/lib/chat/stream-error";
import { detectChatLanguage, type ChatTurnMode } from "@/lib/chat/turn-mode";
import type {
  ChatHistoryMessage,
  DocChatUIMessage,
} from "@/types/api";

export type ChatStreamInput = {
  abortSignal?: AbortSignal;
  context: GroundedChatContext;
  history: readonly ChatHistoryMessage[];
  mode: ChatTurnMode;
  question: string;
  requestId?: string;
};

export type ChatStreamOptions = {
  logger?: Pick<Console, "error">;
  now?: () => Date;
  streamModel?: typeof streamText;
};

function refusalMessage(question: string): string {
  const language = detectChatLanguage(question);

  if (language === "ar") {
    return "لم أجد هذه المعلومة في المستندات المقدمة. Smartly.ai مخصص لتحليل مستنداتك؛ للمحادثة العامة استخدم ChatGPT أو Claude أو Gemini.";
  }

  if (language === "fr") {
    return "Je n’ai pas trouvé cette information dans les documents fournis. Smartly.ai est dédié à leur analyse ; pour une discussion générale, utilisez ChatGPT, Claude ou Gemini.";
  }

  return "I could not find this information in the provided documents. Smartly.ai is dedicated to document analysis; for general conversation, use ChatGPT, Claude, or Gemini.";
}

function toModelMessages(
  history: readonly ChatHistoryMessage[],
  prompt: string,
): ModelMessage[] {
  return [
    ...history.map<ModelMessage>((message) => ({
      role: message.role,
      content: message.content,
    })),
    { role: "user", content: prompt },
  ];
}

export function createChatStreamResponse(
  input: ChatStreamInput,
  options: ChatStreamOptions = {},
): Response {
  const logger = options.logger ?? console;
  let failureLogged = false;
  const onStreamError = (error: unknown): string => {
    const failure = getChatStreamFailure(error, input.question);

    if (!failureLogged) {
      failureLogged = true;
      logger.error(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          level: "error",
          event: "chat.stream.failed",
          requestId: input.requestId ?? "unknown",
          provider: "gemini",
          model: GEMINI_CHAT_MODEL.id,
          errorCode: failure.code,
        }),
      );
    }

    return failure.message;
  };
  const stream = createUIMessageStream<DocChatUIMessage>({
    execute({ writer }) {
      writer.write({
        type: "data-sources",
        data: input.context.sources,
      });

      if (input.mode !== "grounded") {
        const textId = `local-${input.mode}`;
        writer.write({ type: "text-start", id: textId });
        writer.write({
          type: "text-delta",
          id: textId,
          delta: getLocalChatResponse(
            input.mode,
            input.question,
            options.now,
          ),
        });
        writer.write({ type: "text-end", id: textId });
        return;
      }

      if (input.context.chunks.length === 0) {
        const textId = "grounded-refusal";
        writer.write({ type: "text-start", id: textId });
        writer.write({
          type: "text-delta",
          id: textId,
          delta: refusalMessage(input.question),
        });
        writer.write({ type: "text-end", id: textId });
        return;
      }

      const result = (options.streamModel ?? streamText)({
        model: google(GEMINI_CHAT_MODEL.id),
        system: CHAT_SYSTEM_PROMPT,
        messages: toModelMessages(input.history, input.context.prompt),
        maxOutputTokens: GEMINI_CHAT_MODEL.outputTokenLimit,
        maxRetries: 2,
        abortSignal: input.abortSignal,
        timeout: {
          firstChunkMs: 60_000,
          chunkMs: 30_000,
        },
        providerOptions: {
          google: {
            thinkingConfig: {
              thinkingLevel: GEMINI_CHAT_MODEL.thinkingLevel,
            },
          },
        },
      });

      writer.merge(
        result.toUIMessageStream<DocChatUIMessage>({
          onError: onStreamError,
        }),
      );
    },
    onError: onStreamError,
  });

  return createUIMessageStreamResponse({
    stream,
    headers: { "cache-control": "no-store" },
  });
}
