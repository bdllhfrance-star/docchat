import { useChat } from "@ai-sdk/react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import type { DocChatUIMessage } from "@/types/api";

import { ChatWorkspace } from "./chat-workspace";

vi.mock("@ai-sdk/react", () => ({
  useChat: vi.fn(),
}));

const useChatMock = vi.mocked(useChat);
const sendMessage = vi.fn().mockResolvedValue(undefined);
const stop = vi.fn().mockResolvedValue(undefined);
const clearError = vi.fn();

function chatState(
  overrides: Record<string, unknown> = {},
): ReturnType<typeof useChat> {
  return {
    id: "chat-1",
    messages: [],
    status: "ready",
    error: undefined,
    sendMessage,
    stop,
    clearError,
    setMessages: vi.fn(),
    regenerate: vi.fn(),
    resumeStream: vi.fn(),
    addToolResult: vi.fn(),
    addToolOutput: vi.fn(),
    addToolApprovalResponse: vi.fn(),
    ...overrides,
  } as unknown as ReturnType<typeof useChat>;
}

function message(
  id: string,
  role: "user" | "assistant",
  text: string,
): DocChatUIMessage {
  return { id, role, parts: [{ type: "text", text }] };
}

beforeEach(() => {
  sessionStorage.clear();
  sendMessage.mockClear();
  stop.mockClear();
  clearError.mockClear();
  useChatMock.mockReset();
  useChatMock.mockReturnValue(chatState());
});

afterEach(cleanup);

test("enables the composer and sends a trimmed question", async () => {
  const { container } = render(
    <ChatWorkspace batchId="batch-1" documentIds={["document-1"]} />,
  );

  expect(
    await screen.findByRole("heading", { name: "Your documents are ready" }),
  ).toBeDefined();
  expect(screen.getByTestId("rag-pipeline-visualizer")).toBeDefined();
  expect(screen.queryByText("Process replay")).toBeNull();
  expect(
    screen.getByLabelText(
      "Powered by Gemini 3.7 Flash. 1,048,576 input tokens, 65,536 output tokens, medium reasoning.",
    ),
  ).toBeDefined();
  expect(container.querySelectorAll("[data-rag-stage]")).toHaveLength(6);
  expect(container.querySelectorAll("[data-vector-value]")).toHaveLength(12);
  expect(container.querySelectorAll("[data-vector-point]")).toHaveLength(6);
  for (const stage of [
    "Upload",
    "Validate",
    "Extract",
    "Chunk",
    "Embed",
    "Index",
  ]) {
    expect(screen.getByText(stage)).toBeDefined();
  }
  const composer = screen.getByRole("textbox", { name: "Message DocChat" });
  Object.defineProperty(composer, "scrollHeight", {
    configurable: true,
    value: 88,
  });

  fireEvent.change(composer, { target: { value: "  What is required?  " } });
  expect(composer.style.height).toBe("88px");
  expect(composer.style.overflowY).toBe("hidden");
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));

  expect(clearError).toHaveBeenCalledOnce();
  expect(sendMessage).toHaveBeenCalledWith({ text: "What is required?" });
  expect(composer).toHaveProperty("value", "");
  expect(composer.style.height).toBe("56px");

  Object.defineProperty(composer, "scrollHeight", {
    configurable: true,
    value: 220,
  });
  fireEvent.change(composer, { target: { value: "A\nB\nC\nD\nE\nF\nG" } });
  expect(composer.style.height).toBe("108px");
  expect(composer.style.overflowY).toBe("auto");
});

test("keeps the chat mounted while its document context is updating", async () => {
  render(
    <ChatWorkspace
      batchId="batch-1"
      documentIds={["document-1"]}
      isContextUpdating
    />,
  );

  expect(
    await screen.findByRole("heading", { name: "Your documents are ready" }),
  ).toBeDefined();
  expect(screen.getByTestId("rag-pipeline-visualizer")).toBeDefined();
  expect(screen.getByText("Updating document context…")).toBeDefined();
  expect(screen.getByRole("textbox", { name: "Message DocChat" })).toHaveProperty(
    "disabled",
    true,
  );
  expect(screen.getByRole("button", { name: "Send message" })).toHaveProperty(
    "disabled",
    true,
  );
});

test("renders progressive text and allows the request to be stopped", async () => {
  useChatMock.mockReturnValue(
    chatState({
      messages: [
        message("user-1", "user", "Question"),
        message("assistant-1", "assistant", "Partial answer"),
      ],
      status: "streaming",
    }),
  );

  render(
    <ChatWorkspace batchId="batch-1" documentIds={["document-1"]} />,
  );

  expect(await screen.findByText("Partial answer")).toBeDefined();
  expect(screen.queryByTestId("rag-pipeline-visualizer")).toBeNull();
  expect(screen.getByText("Writing the answer…")).toBeDefined();
  expect(screen.getByRole("textbox", { name: "Message DocChat" })).toHaveProperty(
    "disabled",
    true,
  );

  fireEvent.click(screen.getByRole("button", { name: "Stop response" }));
  expect(stop).toHaveBeenCalledOnce();
});

test("shows grounded sources in an accessible disclosure", async () => {
  const answer: DocChatUIMessage = {
    id: "assistant-1",
    role: "assistant",
    parts: [
      {
        type: "data-sources",
        data: [
          {
            documentId: "document-1",
            filename: "guide.pdf",
            excerpt: "The guide requires grounded answers.",
            score: 0.93,
            source: { label: "Page 2", page: 2 },
          },
        ],
      },
      { type: "text", text: "The answer is supported by [1]." },
    ],
  };
  useChatMock.mockReturnValue(chatState({ messages: [answer] }));

  render(
    <ChatWorkspace batchId="batch-1" documentIds={["document-1"]} />,
  );

  const summary = await screen.findByText("1 source");
  const details = summary.closest("details");

  expect(details).toHaveProperty("open", false);
  fireEvent.click(summary.closest("summary") as HTMLElement);
  expect(details).toHaveProperty("open", true);
  expect(screen.getByText("[1] guide.pdf")).toBeDefined();
  expect(screen.getByText("Page 2")).toBeDefined();
  expect(screen.getByText("Similarity 93%")).toBeDefined();
  expect(
    screen.getByText("The guide requires grounded answers."),
  ).toBeDefined();
});

test("labels an RRF source score as hybrid relevance", async () => {
  const answer: DocChatUIMessage = {
    id: "assistant-rrf",
    role: "assistant",
    parts: [
      {
        type: "data-sources",
        data: [
          {
            documentId: "document-1",
            filename: "guide.pdf",
            excerpt: "A hybrid retrieval result.",
            score: 0.0325,
            scoreKind: "rrf",
            source: { label: "Page 3", page: 3 },
          },
        ],
      },
      { type: "text", text: "Hybrid answer." },
    ],
  };
  useChatMock.mockReturnValue(chatState({ messages: [answer] }));

  render(
    <ChatWorkspace batchId="batch-1" documentIds={["document-1"]} />,
  );

  expect(await screen.findByText("Hybrid score 0.0325")).toBeDefined();
});

test("restores and persists the browser-session conversation", async () => {
  const storedMessage = message("user-stored", "user", "Stored question");
  sessionStorage.setItem(
    "docchat:chat:batch-1:document-1",
    JSON.stringify([storedMessage]),
  );
  const currentMessages = [
    storedMessage,
    message("assistant-1", "assistant", "Stored answer"),
  ];
  useChatMock.mockReturnValue(chatState({ messages: currentMessages }));

  render(
    <ChatWorkspace batchId="batch-1" documentIds={["document-1"]} />,
  );

  await waitFor(() => {
    expect(useChatMock).toHaveBeenCalledWith(
      expect.objectContaining({ messages: [storedMessage] }),
    );
  });
  await waitFor(() => {
    expect(
      JSON.parse(
        sessionStorage.getItem("docchat:chat:batch-1:document-1") ?? "[]",
      ),
    )
      .toEqual(currentMessages);
  });
});

test("renders assistant HTML-like output as inert text", async () => {
  const unsafeText = '<img src=x onerror="alert(1)">';
  useChatMock.mockReturnValue(
    chatState({
      messages: [message("assistant-1", "assistant", unsafeText)],
    }),
  );

  const { container } = render(
    <ChatWorkspace batchId="batch-1" documentIds={["document-1"]} />,
  );

  expect(await screen.findByText(unsafeText)).toBeDefined();
  expect(container.querySelector("img")).toBeNull();
});
