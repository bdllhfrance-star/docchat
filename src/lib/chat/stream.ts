import { google } from "@ai-sdk/google";
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  type ModelMessage,
  streamText,
} from "ai";

import { GEMINI_CHAT_MODEL } from "@/lib/ai/model-config";
import {
  buildChatSystemPrompt,
  type GroundedChatContext,
} from "@/lib/chat/grounding";
import { getChatStreamFailure } from "@/lib/chat/stream-error";
import type { ChatTurnMode } from "@/lib/chat/turn-mode";
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

function toConversationMessages(
  history: readonly ChatHistoryMessage[],
  question: string,
): ModelMessage[] {
  return [
    ...history.map<ModelMessage>((message) => ({
      role: message.role,
      content: message.content,
    })),
    { role: "user", content: question.trim() },
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

      const result = (options.streamModel ?? streamText)({
        model: google(GEMINI_CHAT_MODEL.id),
        system: buildChatSystemPrompt(
          input.mode,
          (options.now ?? (() => new Date()))(),
        ),
        messages:
          input.mode === "grounded"
            ? toModelMessages(input.history, input.context.prompt)
            : toConversationMessages(input.history, input.question),
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
