import { DefaultChatTransport } from "ai";

import { extractGeneralAiRedirect } from "@/lib/chat/general-ai-redirect";
import type {
  ChatHistoryMessage,
  ChatRequest,
  DocChatUIMessage,
} from "@/types/api";

export function getUIMessageText(message: DocChatUIMessage): string {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();
}

export function buildChatRequest(
  batchId: string,
  documentIds: readonly string[],
  messages: readonly DocChatUIMessage[],
): ChatRequest {
  const latestMessage = messages.at(-1);

  if (!latestMessage || latestMessage.role !== "user") {
    throw new Error("A user message is required to start the chat request.");
  }

  const message = getUIMessageText(latestMessage);

  if (!message) {
    throw new Error("The chat message cannot be empty.");
  }

  const history = messages.slice(0, -1).flatMap<ChatHistoryMessage>((item) => {
    const rawContent = getUIMessageText(item);
    const content =
      item.role === "assistant"
        ? extractGeneralAiRedirect(rawContent).text
        : rawContent;

    return content && (item.role === "user" || item.role === "assistant")
      ? [{ role: item.role, content }]
      : [];
  });

  return {
    batchId,
    documentIds: [...documentIds],
    message,
    history,
  };
}

export function createDocChatTransport(
  batchId: string,
  documentIds: readonly string[],
): DefaultChatTransport<DocChatUIMessage> {
  return new DefaultChatTransport<DocChatUIMessage>({
    api: "/api/chat",
    prepareSendMessagesRequest: ({ messages }) => ({
      body: buildChatRequest(batchId, documentIds, messages),
    }),
  });
}
