import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";

import Home from "./page";

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
  expect(screen.queryByRole("button", { name: /upload/i })).toBeNull();

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
