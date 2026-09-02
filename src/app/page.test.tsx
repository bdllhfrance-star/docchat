import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import {
  addAndUploadDocuments,
  createAndUploadBatch,
  type ClientBatchUploadResult,
  type ClientUploadUpdate,
} from "@/lib/uploads/client";
import { pollBatchStatus } from "@/lib/batches/client";
import {
  deleteDocument,
  retryDocument,
} from "@/lib/documents/client";
import type { BatchSummary } from "@/types/documents";
import Home from "./page";

vi.mock("@/lib/uploads/client", () => ({
  addAndUploadDocuments: vi.fn(),
  createAndUploadBatch: vi.fn(),
}));
vi.mock("@/lib/batches/client", () => ({
  pollBatchStatus: vi.fn(),
}));
vi.mock("@/lib/documents/client", () => ({
  deleteDocument: vi.fn(),
  retryDocument: vi.fn(),
}));

const addAndUploadDocumentsMock = vi.mocked(addAndUploadDocuments);
const createAndUploadBatchMock = vi.mocked(createAndUploadBatch);
const pollBatchStatusMock = vi.mocked(pollBatchStatus);
const deleteDocumentMock = vi.mocked(deleteDocument);
const retryDocumentMock = vi.mocked(retryDocument);

beforeEach(() => {
  document.documentElement.classList.remove("dark");
  document.documentElement.style.colorScheme = "";
  localStorage.clear();
  sessionStorage.clear();
  addAndUploadDocumentsMock.mockReset();
  createAndUploadBatchMock.mockReset();
  pollBatchStatusMock.mockReset();
  pollBatchStatusMock.mockImplementation(
    () => new Promise<BatchSummary>(() => undefined),
  );
  deleteDocumentMock.mockReset();
  retryDocumentMock.mockReset();
});

afterEach(cleanup);

function file(
  name = "guide.pdf",
  type = "application/pdf",
  size = 1024,
): File {
  const selectedFile = new File(["document"], name, { type });

  Object.defineProperty(selectedFile, "size", { value: size });

  return selectedFile;
}

function uploadResult(
  status: "uploaded" | "failed" = "uploaded",
  error?: string,
): ClientBatchUploadResult {
  return {
    batch: {
      id: "batch-1",
      status: "processing",
      documents: [],
      createdAt: "2026-09-02T12:00:00.000Z",
      expiresAt: "2026-09-09T12:00:00.000Z",
    },
    uploads: [
      {
        index: 0,
        documentId: "document-1",
        status,
        ...(error ? { error } : {}),
      },
    ],
  };
}

test("renders the initial document workspace", () => {
  render(<Home />);

  expect(screen.getByLabelText("Smartly.ai")).toBeDefined();
  expect(screen.queryByText("Answers grounded in your documents")).toBeNull();
  expect(
    screen.getByRole("heading", {
      level: 3,
      name: "Start with your documents",
    }),
  ).toBeDefined();
  expect(
    screen.getByRole("heading", { level: 2, name: "Documents" }),
  ).toBeDefined();
  expect(
    screen.getByRole("button", { name: "Choose documents" }),
  ).toBeDefined();
  expect(
    screen.getByRole("heading", {
      level: 1,
      name: "From files to searchable knowledge",
    }),
  ).toBeDefined();
  expect(screen.queryByText("Session limits")).toBeNull();

  const conversation = screen.getByRole("region", {
    name: "Conversation workspace",
  });
  const documentsPanel = screen.getByRole("complementary", {
    name: "Documents",
  });
  expect(
    within(documentsPanel).getByText(
      "PDF · DOCX · PPTX · XLSX · TXT · MD · CSV · up to 10 files · 10 MiB each · 50 MiB total",
    ),
  ).toBeDefined();
  expect(
    within(conversation).queryByText(
      "PDF · DOCX · PPTX · XLSX · TXT · MD · CSV · up to 10 files · 10 MiB each · 50 MiB total",
    ),
  ).toBeNull();
  expect(conversation.className).toContain("conversation-surface");
  expect(
    within(conversation).queryByRole("button", { name: "Choose documents" }),
  ).toBeNull();
  expect(within(conversation).getByTestId("rag-pipeline-visualizer")).toBeDefined();
});

test("switches and persists the dark theme", async () => {
  render(<Home />);

  const darkThemeButton = await screen.findByRole("button", {
    name: "Use dark theme",
  });
  fireEvent.click(darkThemeButton);

  expect(document.documentElement.classList.contains("dark")).toBe(true);
  expect(document.documentElement.style.colorScheme).toBe("dark");
  expect(localStorage.getItem("docchat-theme")).toBe("dark");

  fireEvent.click(
    screen.getByRole("button", { name: "Use light theme" }),
  );
  expect(document.documentElement.classList.contains("dark")).toBe(false);
  expect(localStorage.getItem("docchat-theme")).toBe("light");
});

test("reflects a dark theme restored before hydration", async () => {
  document.documentElement.classList.add("dark");
  localStorage.setItem("docchat-theme", "dark");

  render(<Home />);

  expect(
    await screen.findByRole("button", { name: "Use light theme" }),
  ).toBeDefined();
});

test("keeps chat unavailable until documents are processed", () => {
  render(<Home />);

  const composer = screen.getByRole("textbox", { name: "Message DocChat" });
  const sendButton = screen.getByRole("button", { name: "Send message" });

  expect(composer).toHaveProperty("disabled", true);
  expect(sendButton).toHaveProperty("disabled", true);
  expect(
    screen.getByText(
      "Add and process at least one document to start chatting.",
    ),
  ).toBeDefined();
  expect(composer.getAttribute("aria-describedby")).toBe("composer-reason");
});

test("selects, validates, and removes multiple files before upload", () => {
  render(<Home />);

  const input = screen.getByLabelText("Select documents from device");
  const validPdf = file();
  const unsupportedFile = file("legacy.doc", "application/msword");

  expect(input).toHaveProperty("multiple", true);
  expect(input.getAttribute("accept")).toBe(
    ".pdf,.docx,.pptx,.xlsx,.txt,.md,.csv",
  );

  fireEvent.change(input, {
    target: { files: [validPdf, unsupportedFile] },
  });

  expect(
    screen.getByRole("heading", { name: "Review your documents" }),
  ).toBeDefined();
  expect(screen.getByRole("list", { name: "Selected documents" })).toBeDefined();
  expect(screen.getByText("guide.pdf")).toBeDefined();
  expect(screen.getByText("legacy.doc")).toBeDefined();
  expect(screen.getByText("This file format is not supported.")).toBeDefined();
  expect(screen.getByText("Selected · not uploaded")).toBeDefined();
  expect(screen.getByRole("button", { name: "Add documents" })).toBeDefined();
  expect(
    screen.getByRole("button", { name: "Upload" }),
  ).toHaveProperty("disabled", true);

  fireEvent.click(screen.getByRole("button", { name: "Remove legacy.doc" }));

  expect(screen.queryByText("legacy.doc")).toBeNull();
  expect(screen.getByLabelText("1 documents")).toBeDefined();
  expect(screen.getByRole("textbox", { name: "Message DocChat" })).toHaveProperty(
    "disabled",
    true,
  );
  expect(
    screen.getByText(
      "Upload the new documents to update the context before chatting.",
    ),
  ).toBeDefined();
});

test("adds files by drag and drop and shows session limit errors", () => {
  render(<Home />);

  const dropZone = screen.getByRole("group", { name: "Document drop zone" });
  const oversizedBatch = Array.from({ length: 11 }, (_, index) =>
    file(`${index}.pdf`, "application/pdf", 5 * 1024 * 1024),
  );

  fireEvent.dragEnter(dropZone, {
    dataTransfer: { files: oversizedBatch },
  });
  expect(screen.getByText("Drop to add documents")).toBeDefined();

  fireEvent.drop(dropZone, {
    dataTransfer: { files: oversizedBatch },
  });

  expect(screen.getByLabelText("11 documents")).toBeDefined();
  expect(
    screen.getByText("Select no more than 10 files in one batch."),
  ).toBeDefined();
  expect(
    screen.getByText("The selection exceeds the 50 MiB batch limit."),
  ).toBeDefined();
});

test("starts one batch action and shows only real upload progress", async () => {
  let publishUpdate!: (update: ClientUploadUpdate) => void;
  let finishUpload!: () => void;

  createAndUploadBatchMock.mockImplementation((_, onUpdate) => {
    publishUpdate = onUpdate;
    onUpdate({ index: 0, status: "creating-batch" });

    return new Promise((resolve) => {
      finishUpload = () => resolve(uploadResult());
    });
  });

  render(<Home />);
  fireEvent.change(screen.getByLabelText("Select documents from device"), {
    target: { files: [file()] },
  });

  const uploadButton = screen.getByRole("button", {
    name: "Upload",
  });
  expect(uploadButton).toHaveProperty("disabled", false);

  fireEvent.click(uploadButton);
  fireEvent.click(uploadButton);

  expect(createAndUploadBatchMock).toHaveBeenCalledOnce();
  expect(screen.getByText("Creating batch")).toBeDefined();
  expect(screen.getByRole("button", { name: "Add documents" })).toHaveProperty(
    "disabled",
    true,
  );
  expect(screen.getByRole("button", { name: "Remove guide.pdf" })).toHaveProperty(
    "disabled",
    true,
  );

  act(() => {
    publishUpdate({ index: 0, status: "uploading", progress: 42 });
  });

  const progress = screen.getByRole("progressbar", { name: "Uploading 42%" });
  expect(progress.getAttribute("aria-valuenow")).toBe("42");
  expect(
    screen
      .getByText("guide.pdf")
      .closest("li")
      ?.querySelector('[data-operation="upload-transfer"]'),
  ).not.toBeNull();
  expect(screen.getByRole("textbox", { name: "Message DocChat" })).toHaveProperty(
    "disabled",
    true,
  );

  await act(async () => {
    publishUpdate({ index: 0, status: "uploaded", progress: 100 });
    finishUpload();
  });

  expect(
    screen.getByText("Uploaded · waiting for processing"),
  ).toBeDefined();
  expect(screen.queryByText("Ready")).toBeNull();
  expect(
    screen.getByText("Documents are being processed. Chat remains unavailable."),
  ).toBeDefined();
  expect(screen.getByRole("button", { name: "Remove guide.pdf" })).toHaveProperty(
    "disabled",
    true,
  );
});

test("shows a global batch creation error and permits a safe retry", async () => {
  createAndUploadBatchMock.mockImplementation(async (_, onUpdate) => {
    onUpdate({ index: 0, status: "creating-batch" });
    throw new Error("The session could not be created.");
  });

  render(<Home />);
  fireEvent.change(screen.getByLabelText("Select documents from device"), {
    target: { files: [file()] },
  });
  fireEvent.click(screen.getByRole("button", { name: "Upload" }));

  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toContain(
    "Upload failed: The session could not be created.",
  );
  expect(screen.getByText("Selected · not uploaded")).toBeDefined();
  expect(
    screen.getByRole("button", { name: "Upload" }),
  ).toHaveProperty("disabled", false);
  expect(screen.getByRole("textbox", { name: "Message DocChat" })).toHaveProperty(
    "disabled",
    true,
  );
});

test("shows an isolated file upload failure without opening chat", async () => {
  createAndUploadBatchMock.mockImplementation(async (_, onUpdate) => {
    onUpdate({ index: 0, status: "creating-batch" });
    onUpdate({ index: 0, status: "uploading", progress: 15 });
    onUpdate({
      index: 0,
      status: "failed",
      error: "Connection interrupted.",
    });

    return uploadResult("failed", "Connection interrupted.");
  });

  render(<Home />);
  fireEvent.change(screen.getByLabelText("Select documents from device"), {
    target: { files: [file()] },
  });
  fireEvent.click(screen.getByRole("button", { name: "Upload" }));

  await waitFor(() => {
    expect(screen.getByText("Upload failed")).toBeDefined();
  });
  expect(screen.getByText("Connection interrupted.")).toBeDefined();
  expect(
    screen.getByText("A document failed. Chat remains unavailable."),
  ).toBeDefined();
  expect(screen.getByRole("button", { name: "Send message" })).toHaveProperty(
    "disabled",
    true,
  );
});

test("keeps each file row stable while showing real processing states", async () => {
  let publishReady!: () => void;
  const extractingBatch: BatchSummary = {
    ...uploadResult().batch,
    documents: [
      {
        id: "document-1",
        batchId: "batch-1",
        filename: "guide.pdf",
        fileType: "pdf",
        size: 1024,
        status: "extracting",
      },
    ],
  };
  const readyBatch: BatchSummary = {
    ...extractingBatch,
    status: "ready",
    documents: [{ ...extractingBatch.documents[0], status: "ready" }],
  };

  createAndUploadBatchMock.mockImplementation(async (_, onUpdate) => {
    onUpdate({ index: 0, status: "uploaded", progress: 100 });
    return uploadResult();
  });
  pollBatchStatusMock.mockImplementation((_, onUpdate) => {
    onUpdate(extractingBatch);

    return new Promise((resolve) => {
      publishReady = () => {
        onUpdate(readyBatch);
        resolve(readyBatch);
      };
    });
  });

  render(<Home />);
  fireEvent.change(screen.getByLabelText("Select documents from device"), {
    target: { files: [file()] },
  });
  fireEvent.click(screen.getByRole("button", { name: "Upload" }));

  expect(await screen.findByText("Extracting text")).toBeDefined();
  expect(screen.getByText("guide.pdf")).toBeDefined();
  expect(
    screen
      .getByText("guide.pdf")
      .closest("li")
      ?.querySelector('[data-operation="extracting"]'),
  ).not.toBeNull();
  expect(
    screen.getByRole("status").getAttribute("aria-live"),
  ).toBe("polite");

  act(() => publishReady());

  expect(await screen.findByText("Ready")).toBeDefined();
  expect(screen.getByText("guide.pdf")).toBeDefined();
  expect(
    screen
      .getByText("guide.pdf")
      .closest("li")
      ?.querySelector('[data-operation="ready"]'),
  ).not.toBeNull();
  expect(
    await screen.findByRole("heading", { name: "Your documents are ready" }),
  ).toBeDefined();
  expect(screen.getByRole("textbox", { name: "Message DocChat" })).toHaveProperty(
    "disabled",
    false,
  );
});

test("selects all ready documents by default and allows a chat subset", async () => {
  const files = [file("guide.pdf"), file("appendix.pdf")];
  const documents = [
    {
      id: "document-1",
      batchId: "batch-1",
      filename: "guide.pdf",
      fileType: "pdf" as const,
      size: 1024,
      status: "ready" as const,
    },
    {
      id: "document-2",
      batchId: "batch-1",
      filename: "appendix.pdf",
      fileType: "pdf" as const,
      size: 1024,
      status: "ready" as const,
    },
  ];
  const readyBatch: BatchSummary = {
    id: "batch-1",
    status: "ready",
    documents,
    createdAt: "2026-09-02T12:00:00.000Z",
    expiresAt: "2026-09-09T12:00:00.000Z",
  };

  createAndUploadBatchMock.mockResolvedValue({
    batch: { ...readyBatch, status: "processing", documents: [] },
    uploads: [
      { index: 0, documentId: "document-1", status: "uploaded" },
      { index: 1, documentId: "document-2", status: "uploaded" },
    ],
  });
  pollBatchStatusMock.mockImplementationOnce(async (_, onUpdate) => {
    onUpdate(readyBatch);
    return readyBatch;
  });

  render(<Home />);
  fireEvent.change(screen.getByLabelText("Select documents from device"), {
    target: { files },
  });
  fireEvent.click(screen.getByRole("button", { name: "Upload" }));

  const guideCheckbox = await screen.findByRole("checkbox", {
    name: "Use guide.pdf in chat",
  });
  const appendixCheckbox = screen.getByRole("checkbox", {
    name: "Use appendix.pdf in chat",
  });

  expect(guideCheckbox).toHaveProperty("checked", true);
  expect(appendixCheckbox).toHaveProperty("checked", true);
  expect(screen.getByText(/Answers use 2 ready documents/)).toBeDefined();

  fireEvent.click(appendixCheckbox);

  expect(appendixCheckbox).toHaveProperty("checked", false);
  expect(guideCheckbox).toHaveProperty("disabled", true);
  expect(screen.getByText(/Answers use 1 ready document\./)).toBeDefined();
});

test("retries a failed document and resumes status polling", async () => {
  let finishRetry!: () => void;
  const failedDocument = {
    id: "document-1",
    batchId: "batch-1",
    filename: "guide.pdf",
    fileType: "pdf",
    size: 1024,
    status: "failed",
    canRetry: true,
    error: { code: "PROVIDER_ERROR", message: "Embedding failed." },
  } as const;
  const failedBatch: BatchSummary = {
    ...uploadResult().batch,
    status: "failed",
    documents: [failedDocument],
  };
  const readyDocument = {
    ...failedDocument,
    status: "ready",
    canRetry: false,
    error: undefined,
  } as const;
  const readyBatch: BatchSummary = {
    ...failedBatch,
    status: "ready",
    documents: [readyDocument],
  };

  createAndUploadBatchMock.mockImplementation(async (_, onUpdate) => {
    onUpdate({ index: 0, status: "uploaded", progress: 100 });
    return uploadResult();
  });
  pollBatchStatusMock
    .mockImplementationOnce(async (_, onUpdate) => {
      onUpdate(failedBatch);
      return failedBatch;
    })
    .mockImplementationOnce(async (_, onUpdate) => {
      onUpdate(readyBatch);
      return readyBatch;
    });
  retryDocumentMock.mockImplementation(
    () =>
      new Promise((resolve) => {
        finishRetry = () => resolve(readyDocument);
      }),
  );

  render(<Home />);
  fireEvent.change(screen.getByLabelText("Select documents from device"), {
    target: { files: [file()] },
  });
  fireEvent.click(screen.getByRole("button", { name: "Upload" }));

  const retryButton = await screen.findByRole("button", {
    name: "Retry guide.pdf",
  });
  fireEvent.click(retryButton);

  expect(screen.getByText("Retrying")).toBeDefined();
  expect(
    screen
      .getByText("guide.pdf")
      .closest("li")
      ?.querySelector('[data-operation="retrying"]'),
  ).not.toBeNull();
  expect(deleteDocumentMock).not.toHaveBeenCalled();

  await act(async () => finishRetry());

  expect(retryDocumentMock).toHaveBeenCalledWith("document-1");
  expect(await screen.findByText("Ready")).toBeDefined();
  expect(pollBatchStatusMock).toHaveBeenCalledTimes(2);
});

test("adds documents to the existing batch and updates the context", async () => {
  const firstDocument = {
    id: "document-1",
    batchId: "batch-1",
    filename: "guide.pdf",
    fileType: "pdf",
    size: 1024,
    status: "ready",
  } as const;
  const initialReadyBatch: BatchSummary = {
    ...uploadResult().batch,
    status: "ready",
    documents: [firstDocument],
  };
  const addedDocument = {
    id: "document-2",
    batchId: "batch-1",
    filename: "appendix.xlsx",
    fileType: "xlsx" as const,
    status: "ready" as const,
    size: 1024,
  };
  const updatedReadyBatch: BatchSummary = {
    ...initialReadyBatch,
    status: "ready",
    documents: [firstDocument, addedDocument],
  };

  createAndUploadBatchMock.mockImplementation(async (_, onUpdate) => {
    onUpdate({ index: 0, status: "uploaded", progress: 100 });
    return uploadResult();
  });
  pollBatchStatusMock
    .mockImplementationOnce(async (_, onUpdate) => {
      onUpdate(initialReadyBatch);
      return initialReadyBatch;
    })
    .mockImplementationOnce(async (_, onUpdate) => {
      onUpdate(updatedReadyBatch);
      return updatedReadyBatch;
    });
  addAndUploadDocumentsMock.mockImplementation(
    async (_, additions, onUpdate) => {
      onUpdate({ index: additions[0].index, status: "preparing-update" });
      onUpdate({ index: additions[0].index, status: "uploaded", progress: 100 });

      return {
        batch: {
          ...initialReadyBatch,
          status: "processing",
          documents: [
            firstDocument,
            { ...addedDocument, status: "queued" },
          ],
        },
        uploads: [
          { index: additions[0].index, documentId: "document-2", status: "uploaded" },
        ],
      };
    },
  );

  render(<Home />);
  fireEvent.change(screen.getByLabelText("Select documents from device"), {
    target: { files: [file()] },
  });
  fireEvent.click(screen.getByRole("button", { name: "Upload" }));
  await screen.findByRole("button", { name: "Add documents" });

  const addedFile = file(
    "appendix.xlsx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  fireEvent.change(screen.getByLabelText("Select documents from device"), {
    target: { files: [addedFile] },
  });
  expect(screen.getByText("guide.pdf")).toBeDefined();
  expect(screen.getByText("appendix.xlsx")).toBeDefined();

  await waitFor(() =>
    expect(addAndUploadDocumentsMock).toHaveBeenCalledWith(
      "batch-1",
      [{ file: addedFile, index: 1 }],
      expect.any(Function),
    ),
  );
  expect(await screen.findByRole("checkbox", {
    name: "Use appendix.xlsx in chat",
  })).toBeDefined();
  expect(screen.getByText("guide.pdf")).toBeDefined();
  expect(pollBatchStatusMock).toHaveBeenCalledTimes(2);
});

test("removes a deleted document from the active chat context", async () => {
  const files = [file("guide.pdf"), file("appendix.pdf")];
  const readyBatch: BatchSummary = {
    id: "batch-1",
    status: "ready",
    documents: [
      {
        id: "document-1",
        batchId: "batch-1",
        filename: "guide.pdf",
        fileType: "pdf",
        size: 1024,
        status: "ready",
      },
      {
        id: "document-2",
        batchId: "batch-1",
        filename: "appendix.pdf",
        fileType: "pdf",
        size: 1024,
        status: "ready",
      },
    ],
    createdAt: "2026-09-02T12:00:00.000Z",
    expiresAt: "2026-09-09T12:00:00.000Z",
  };

  createAndUploadBatchMock.mockResolvedValue({
    batch: { ...readyBatch, status: "processing", documents: [] },
    uploads: [
      { index: 0, documentId: "document-1", status: "uploaded" },
      { index: 1, documentId: "document-2", status: "uploaded" },
    ],
  });
  pollBatchStatusMock.mockImplementationOnce(async (_, onUpdate) => {
    onUpdate(readyBatch);
    return readyBatch;
  });
  deleteDocumentMock.mockResolvedValue();

  render(<Home />);
  fireEvent.change(screen.getByLabelText("Select documents from device"), {
    target: { files },
  });
  fireEvent.click(screen.getByRole("button", { name: "Upload" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "Delete guide.pdf" }),
  );

  await waitFor(() => {
    expect(screen.queryByText("guide.pdf")).toBeNull();
  });
  expect(deleteDocumentMock).toHaveBeenCalledWith("document-1");
  expect(
    screen.getByRole("checkbox", { name: "Use appendix.pdf in chat" }),
  ).toHaveProperty("checked", true);
  expect(screen.getByText(/Answers use 1 ready document\./)).toBeDefined();
});

test("deletes the last ready document and returns to the initial workspace", async () => {
  let finishDeletion!: () => void;
  const readyBatch: BatchSummary = {
    ...uploadResult().batch,
    status: "ready",
    documents: [
      {
        id: "document-1",
        batchId: "batch-1",
        filename: "guide.pdf",
        fileType: "pdf",
        size: 1024,
        status: "ready",
        canRetry: false,
      },
    ],
  };

  createAndUploadBatchMock.mockImplementation(async (_, onUpdate) => {
    onUpdate({ index: 0, status: "uploaded", progress: 100 });
    return uploadResult();
  });
  pollBatchStatusMock.mockImplementationOnce(async (_, onUpdate) => {
    onUpdate(readyBatch);
    return readyBatch;
  });
  deleteDocumentMock.mockImplementation(
    () =>
      new Promise((resolve) => {
        finishDeletion = resolve;
      }),
  );

  render(<Home />);
  fireEvent.change(screen.getByLabelText("Select documents from device"), {
    target: { files: [file()] },
  });
  fireEvent.click(screen.getByRole("button", { name: "Upload" }));

  const deleteButton = await screen.findByRole("button", {
    name: "Delete guide.pdf",
  });
  fireEvent.click(deleteButton);

  expect(screen.getByText("Deleting")).toBeDefined();
  expect(screen.getByText("guide.pdf").closest("li")?.className).toContain(
    "document-row-deleting",
  );
  expect(
    screen.getByRole("heading", { name: "Your documents are ready" }),
  ).toBeDefined();
  expect(
    within(
      screen.getByRole("region", { name: "Conversation workspace" }),
    ).queryByRole("heading", { name: "Review your documents" }),
  ).toBeNull();
  expect(screen.getByText("Updating document context…")).toBeDefined();
  expect(screen.getByRole("textbox", { name: "Message DocChat" })).toHaveProperty(
    "disabled",
    true,
  );
  await act(async () => finishDeletion());

  expect(deleteDocumentMock).toHaveBeenCalledWith("document-1");
  expect(
    screen.getByRole("heading", { name: "Start with your documents" }),
  ).toBeDefined();
  expect(
    screen.getByRole("button", { name: "Choose documents" }),
  ).toBeDefined();
});

test("keeps a document visible when its deletion fails", async () => {
  const readyBatch: BatchSummary = {
    ...uploadResult().batch,
    status: "ready",
    documents: [
      {
        id: "document-1",
        batchId: "batch-1",
        filename: "guide.pdf",
        fileType: "pdf",
        size: 1024,
        status: "ready",
      },
    ],
  };

  createAndUploadBatchMock.mockResolvedValue(uploadResult());
  pollBatchStatusMock.mockImplementationOnce(async (_, onUpdate) => {
    onUpdate(readyBatch);
    return readyBatch;
  });
  deleteDocumentMock.mockRejectedValue(
    new Error("The stored file could not be removed."),
  );

  render(<Home />);
  fireEvent.change(screen.getByLabelText("Select documents from device"), {
    target: { files: [file()] },
  });
  fireEvent.click(screen.getByRole("button", { name: "Upload" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "Delete guide.pdf" }),
  );

  expect(
    await screen.findByText("The stored file could not be removed."),
  ).toBeDefined();
  expect(screen.getByText("guide.pdf")).toBeDefined();
});
