import { useChat } from "@ai-sdk/react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import type { DocChatUIMessage } from "@/types/api";
import { GENERAL_AI_REDIRECT_MARKER } from "@/lib/chat/general-ai-redirect";

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
  expect(
    screen
      .getByTestId("thinking-indicator")
      .querySelector('img[src*="smartly-ai-mark.png"]'),
  ).not.toBeNull();
  expect(screen.getByRole("textbox", { name: "Message DocChat" })).toHaveProperty(
    "disabled",
    true,
  );

  fireEvent.click(screen.getByRole("button", { name: "Stop response" }));
  expect(stop).toHaveBeenCalledOnce();
});

test("renders assistant Markdown directly on the surface with inline citations", async () => {
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
      {
        type: "text",
        text: "### Profile\n\nThe answer is **grounded** by [1].\n\n- First fact\n- Second fact",
      },
    ],
  };
  useChatMock.mockReturnValue(chatState({ messages: [answer] }));

  const { container } = render(
    <ChatWorkspace batchId="batch-1" documentIds={["document-1"]} />,
  );

  expect(await screen.findByRole("heading", { name: "Profile" })).toBeDefined();
  expect(screen.getByText("grounded").tagName).toBe("STRONG");
  expect(screen.getAllByRole("listitem")).toHaveLength(2);
  expect(screen.queryByText(/\*\*grounded\*\*/u)).toBeNull();
  expect(screen.queryByText("1 source")).toBeNull();
  expect(screen.queryByText(/Similarity|Hybrid score/u)).toBeNull();

  const assistantSurface = container.querySelector("[data-assistant-content]");
  expect(assistantSurface).not.toBeNull();
  expect(assistantSurface?.className).not.toContain("bg-white");
  expect(assistantSurface?.className).not.toContain("rounded-2xl");

  const citation = screen.getByRole("button", {
    name: "Open source 1: guide.pdf, Page 2",
  });
  expect(citation.getAttribute("aria-haspopup")).toBe("dialog");
  expect(screen.queryByLabelText("Source 1 details")).toBeNull();
  vi.spyOn(citation, "getBoundingClientRect").mockReturnValue({
    bottom: 318,
    height: 18,
    left: 240,
    right: 260,
    top: 300,
    width: 20,
    x: 240,
    y: 300,
    toJSON: () => ({}),
  });

  fireEvent.click(citation);
  const sourcePopover = screen.getByLabelText("Source 1 details");
  expect(sourcePopover.className).toContain("fixed");
  expect(sourcePopover.style.left).toBe("240px");
  expect(sourcePopover.style.top).toBe("326px");
  expect(sourcePopover.getAttribute("data-placement")).toBe("below");
  expect(sourcePopover.parentElement).toBe(document.body);
  expect(screen.getByText("[1] guide.pdf")).toBeDefined();
  expect(screen.getByText("Page 2")).toBeDefined();
  expect(
    screen.getByText("The guide requires grounded answers."),
  ).toBeDefined();

  fireEvent.scroll(window);
  expect(screen.queryByLabelText("Source 1 details")).toBeNull();

  fireEvent.click(citation);
  expect(screen.getByLabelText("Source 1 details")).toBeDefined();
  fireEvent.click(screen.getByRole("button", { name: "Close source details" }));
  expect(screen.queryByLabelText("Source 1 details")).toBeNull();
});

test("keeps citations attached to the sources of their own answer", async () => {
  const answers: DocChatUIMessage[] = [
    {
      id: "assistant-first",
      role: "assistant",
      parts: [
        {
          type: "data-sources",
          data: [
            {
              documentId: "document-1",
              filename: "first.pdf",
              excerpt: "First answer evidence.",
              score: 0.0325,
              scoreKind: "rrf",
              source: { label: "Page 3", page: 3 },
            },
          ],
        },
        { type: "text", text: "First answer [1]." },
      ],
    },
    {
      id: "assistant-second",
      role: "assistant",
      parts: [
        {
          type: "data-sources",
          data: [
            {
              documentId: "document-2",
              filename: "second.docx",
              excerpt: "Second answer evidence.",
              score: 0.0161,
              scoreKind: "rrf",
              source: { label: "Section Experience", section: "Experience" },
            },
          ],
        },
        { type: "text", text: "Second answer [1]." },
      ],
    },
  ];
  useChatMock.mockReturnValue(chatState({ messages: answers }));

  render(
    <ChatWorkspace batchId="batch-1" documentIds={["document-1", "document-2"]} />,
  );

  const citations = await screen.findAllByRole("button", {
    name: /Open source 1:/u,
  });
  expect(citations).toHaveLength(2);
  fireEvent.click(citations[1]);

  expect(screen.getByText("[1] second.docx")).toBeDefined();
  expect(screen.getByText("Second answer evidence.")).toBeDefined();
  expect(screen.queryByText("First answer evidence.")).toBeNull();
  expect(screen.queryByText(/0\.0325|0\.0161|Hybrid score/u)).toBeNull();
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

test("renders trusted general AI destinations only for an explicit redirect", async () => {
  useChatMock.mockReturnValue(
    chatState({
      messages: [
        message(
          "assistant-redirect",
          "assistant",
          `This topic is outside document analysis.\n\n${GENERAL_AI_REDIRECT_MARKER}`,
        ),
        message(
          "assistant-comparison",
          "assistant",
          "The document compares ChatGPT, Claude and Gemini.",
        ),
      ],
    }),
  );

  render(
    <ChatWorkspace batchId="batch-1" documentIds={["document-1"]} />,
  );

  expect(screen.queryByText(GENERAL_AI_REDIRECT_MARKER)).toBeNull();
  expect(
    screen.getByRole("navigation", {
      name: "Continue with a general AI assistant",
    }),
  ).toBeDefined();

  for (const [label, href] of [
    ["ChatGPT", "https://chatgpt.com/"],
    ["Claude", "https://claude.ai/"],
    ["Gemini", "https://gemini.google.com/"],
  ] as const) {
    const link = screen.getByRole("link", {
      name: `Open ${label} in a new tab`,
    });
    expect(link.getAttribute("href")).toBe(href);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  }

  expect(
    screen.getAllByText("The document compares ChatGPT, Claude and Gemini."),
  ).toHaveLength(1);
});
