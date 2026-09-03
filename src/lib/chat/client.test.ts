import { describe, expect, test } from "vitest";

import { GENERAL_AI_REDIRECT_MARKER } from "@/lib/chat/general-ai-redirect";
import type { DocChatUIMessage } from "@/types/api";

import { buildChatRequest, getUIMessageText } from "./client";

function message(
  id: string,
  role: "user" | "assistant",
  text: string,
): DocChatUIMessage {
  return {
    id,
    role,
    parts: [{ type: "text", text }],
  };
}

describe("chat client request", () => {
  test("separates the latest question from the text-only history", () => {
    const messages: DocChatUIMessage[] = [
      message("user-1", "user", "Earlier question"),
      {
        ...message("assistant-1", "assistant", "Earlier answer"),
        parts: [
          {
            type: "data-sources",
            data: [],
          },
          { type: "text", text: "Earlier answer" },
        ],
      },
      message("user-2", "user", "  Latest question  "),
    ];

    expect(buildChatRequest("batch-1", ["document-1"], messages)).toEqual({
      batchId: "batch-1",
      documentIds: ["document-1"],
      message: "Latest question",
      history: [
        { role: "user", content: "Earlier question" },
        { role: "assistant", content: "Earlier answer" },
      ],
    });
  });

  test("joins streamed text parts and ignores source data parts", () => {
    const value: DocChatUIMessage = {
      id: "assistant-1",
      role: "assistant",
      parts: [
        { type: "data-sources", data: [] },
        { type: "text", text: "First" },
        { type: "text", text: "part" },
      ],
    };

    expect(getUIMessageText(value)).toBe("First\npart");
  });

  test("does not send the presentation marker back in chat history", () => {
    const request = buildChatRequest("batch-1", ["document-1"], [
      message(
        "assistant-1",
        "assistant",
        `Use a general assistant.\n\n${GENERAL_AI_REDIRECT_MARKER}`,
      ),
      message("user-1", "user", "Why?"),
    ]);

    expect(request.history).toEqual([
      { role: "assistant", content: "Use a general assistant." },
    ]);
    expect(JSON.stringify(request)).not.toContain(GENERAL_AI_REDIRECT_MARKER);
  });

  test("rejects a request without a final user question", () => {
    expect(() =>
      buildChatRequest("batch-1", ["document-1"], [
        message("assistant-1", "assistant", "Answer"),
      ]),
    ).toThrow("A user message is required");
  });
});
