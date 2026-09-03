// @vitest-environment node

import { describe, expect, test, vi } from "vitest";
import type { streamText } from "ai";

import { buildGroundedChatContext } from "@/lib/chat/grounding";

import { createChatStreamResponse } from "./stream";

function modelStream(): ReadableStream<never> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue({ type: "text-start", id: "answer" } as never);
      controller.enqueue({
        type: "text-delta",
        id: "answer",
        delta: "Grounded answer.",
      } as never);
      controller.enqueue({ type: "text-end", id: "answer" } as never);
      controller.close();
    },
  });
}

describe("chat UI stream", () => {
  test("streams a deterministic refusal without calling Gemini when no context exists", async () => {
    const streamModel = vi.fn();
    const context = buildGroundedChatContext(
      "Que dit le document ?",
      [],
      [],
    );
    const response = createChatStreamResponse(
      {
        context,
        history: [],
        mode: "grounded",
        question: "Que dit le document ?",
      },
      { streamModel: streamModel as unknown as typeof streamText },
    );
    const body = await response.text();

    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(body).toContain('"type":"data-sources"');
    expect(body).toContain("Je n’ai pas trouvé cette information");
    expect(streamModel).not.toHaveBeenCalled();
  });

  test("sends persistent sources before merging the Gemini text stream", async () => {
    const context = buildGroundedChatContext("What is required?", [], [
      {
        id: "chunk-1",
        documentId: "document-1",
        filename: "guide.pdf",
        fileType: "pdf",
        text: "The guide requires grounded answers.",
        source: { label: "Page 2", page: 2 },
        chunkIndex: 1,
        score: 0.93,
      },
    ]);
    const toUIMessageStream = vi.fn(() => modelStream());
    const streamModel = vi.fn((settings: unknown) => {
      void settings;
      return { toUIMessageStream };
    });
    const response = createChatStreamResponse(
      {
        context,
        history: [{ role: "assistant", content: "Earlier answer" }],
        mode: "grounded",
        question: "What is required?",
      },
      { streamModel: streamModel as unknown as typeof streamText },
    );
    const body = await response.text();
    const settings = streamModel.mock.calls[0][0] as {
      system: string;
      messages: unknown[];
    } & Record<string, unknown>;

    expect(settings).toMatchObject({
      maxOutputTokens: 65_536,
      maxRetries: 2,
      providerOptions: {
        google: { thinkingConfig: { thinkingLevel: "medium" } },
      },
      timeout: { firstChunkMs: 60_000, chunkMs: 30_000 },
    });
    expect(settings.system).toContain("only from the document context");
    expect(settings.messages).toEqual([
      { role: "assistant", content: "Earlier answer" },
      expect.objectContaining({
        role: "user",
        content: expect.stringContaining("DOCUMENT_CONTEXT_JSONL_BEGIN"),
      }),
    ]);
    expect(toUIMessageStream).toHaveBeenCalledWith({
      onError: expect.any(Function),
    });
    expect(body.indexOf('"type":"data-sources"')).toBeLessThan(
      body.indexOf("Grounded answer."),
    );
    expect(body).toContain('"score":0.93');
  });

  test("lets Gemini answer a greeting without retrieval context or sources", async () => {
    const context = buildGroundedChatContext("Hello!", [], []);
    const toUIMessageStream = vi.fn(() => modelStream());
    const streamModel = vi.fn((settings: unknown) => {
      void settings;
      return { toUIMessageStream };
    });
    const response = createChatStreamResponse(
      {
        context,
        history: [{ role: "assistant", content: "An earlier document answer." }],
        mode: "conversation",
        question: "Hello!",
      },
      { streamModel: streamModel as unknown as typeof streamText },
    );
    const body = await response.text();
    const settings = streamModel.mock.calls[0][0] as {
      messages: unknown[];
      system: string;
    };

    expect(settings.system).toContain("brief social or interface-level message");
    expect(settings.messages).toEqual([{ role: "user", content: "Hello!" }]);
    expect(body).toContain('"data":[]');
    expect(body).not.toContain("I could not find this information");
  });
});
