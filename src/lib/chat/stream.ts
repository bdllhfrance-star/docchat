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
import type {
  ChatHistoryMessage,
  DocChatUIMessage,
} from "@/types/api";

const streamErrorMessage = "The answer stream failed. Please try again.";

export type ChatStreamInput = {
  abortSignal?: AbortSignal;
  context: GroundedChatContext;
  history: readonly ChatHistoryMessage[];
  question: string;
};

export type ChatStreamOptions = {
  streamModel?: typeof streamText;
};

function refusalMessage(question: string): string {
  if (/\p{Script=Arabic}/u.test(question)) {
    return "لم أجد هذه المعلومة في المستندات المقدمة.";
  }

  if (
    /[àâçéèêëîïôùûüÿœ]/iu.test(question) ||
    /\b(quel|quelle|quels|quelles|comment|pourquoi|document|selon|dans)\b/iu.test(
      question,
    )
  ) {
    return "Je n’ai pas trouvé cette information dans les documents fournis.";
  }

  return "I could not find this information in the provided documents.";
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
  const stream = createUIMessageStream<DocChatUIMessage>({
    execute({ writer }) {
      writer.write({
        type: "data-sources",
        data: input.context.sources,
      });

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
          onError: () => streamErrorMessage,
        }),
      );
    },
    onError: () => streamErrorMessage,
  });

  return createUIMessageStreamResponse({
    stream,
    headers: { "cache-control": "no-store" },
  });
}
