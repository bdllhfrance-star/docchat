import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import {
  createAndUploadBatch,
  type ClientBatchUploadResult,
  type ClientUploadUpdate,
} from "@/lib/uploads/client";
import Home from "./page";

vi.mock("@/lib/uploads/client", () => ({
  createAndUploadBatch: vi.fn(),
}));

const createAndUploadBatchMock = vi.mocked(createAndUploadBatch);

beforeEach(() => {
  createAndUploadBatchMock.mockReset();
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

  expect(
    screen.getByRole("heading", {
      level: 1,
      name: "Start with your documents",
    }),
  ).toBeDefined();
  expect(
    screen.getByRole("heading", { level: 2, name: "Documents" }),
  ).toBeDefined();
  expect(screen.getByText("No documents yet")).toBeDefined();
  expect(
    screen.getByRole("button", { name: "Choose documents" }),
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
  expect(screen.getByRole("button", { name: "Replace selection" })).toBeDefined();
  expect(
    screen.getByRole("button", { name: "Upload and process" }),
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
      "Selected documents must be uploaded and fully processed before chatting.",
    ),
  ).toBeDefined();
});

test("replaces the selection by drag and drop and shows batch errors", () => {
  render(<Home />);

  const dropZone = screen.getByRole("group", { name: "Document drop zone" });
  const oversizedBatch = Array.from({ length: 11 }, (_, index) =>
    file(`${index}.pdf`, "application/pdf", 5 * 1024 * 1024),
  );

  fireEvent.dragEnter(dropZone, {
    dataTransfer: { files: oversizedBatch },
  });
  expect(screen.getByText("Drop to replace the selection")).toBeDefined();

  fireEvent.drop(dropZone, {
    dataTransfer: { files: oversizedBatch },
  });

  expect(screen.getByText("11 files selected")).toBeDefined();
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
    name: "Upload and process",
  });
  expect(uploadButton).toHaveProperty("disabled", false);

  fireEvent.click(uploadButton);
  fireEvent.click(uploadButton);

  expect(createAndUploadBatchMock).toHaveBeenCalledOnce();
  expect(screen.getByText("Creating batch")).toBeDefined();
  expect(screen.getByRole("button", { name: "Replace selection" })).toHaveProperty(
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
    screen.getByText("Uploaded documents are waiting for full processing."),
  ).toBeDefined();
  expect(screen.getByRole("button", { name: "Replace selection" })).toHaveProperty(
    "disabled",
    true,
  );
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
  fireEvent.click(screen.getByRole("button", { name: "Upload and process" }));

  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toContain(
    "Batch creation failed: The session could not be created.",
  );
  expect(screen.getByText("Selected · not uploaded")).toBeDefined();
  expect(
    screen.getByRole("button", { name: "Upload and process" }),
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
  fireEvent.click(screen.getByRole("button", { name: "Upload and process" }));

  await waitFor(() => {
    expect(screen.getByText("Upload failed")).toBeDefined();
  });
  expect(screen.getByText("Connection interrupted.")).toBeDefined();
  expect(
    screen.getByText("A file upload failed. Chat remains unavailable."),
  ).toBeDefined();
  expect(screen.getByRole("button", { name: "Send message" })).toHaveProperty(
    "disabled",
    true,
  );
});
