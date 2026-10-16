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

  expect(screen.getByLabelText("CNOM · Assistant documentaire")).toBeDefined();
  expect(screen.queryByText("Answers grounded in your documents")).toBeNull();
  expect(
    screen.getByRole("heading", {
      level: 3,
      name: "Ajoutez vos documents",
    }),
  ).toBeDefined();
  expect(
    screen.getByRole("heading", { level: 2, name: "Documents" }),
  ).toBeDefined();
  expect(
    screen.getByRole("button", { name: "Choisir des documents" }),
  ).toBeDefined();
  expect(
    screen.getByRole("heading", {
      level: 1,
      name: "L’information au service du mouvement olympique",
    }),
  ).toBeDefined();
  const geminiSignature = screen.getByLabelText(
    /Propulsé par Gemini 3\.8 Flash\..*tokens en entrée.*raisonnement de niveau moyen\./u,
  );
  expect(document.body.textContent).not.toMatch(/Choose documents|Upload|Powered by|reasoning|up to 10 files/);
  expect(geminiSignature).toBeDefined();
  expect(
    geminiSignature.querySelector("img")?.getAttribute("src"),
  ).toContain("gemini-spark-logo.png");
  expect(screen.queryByText("Pipeline overview")).toBeNull();
  expect(screen.queryByText("Session limits")).toBeNull();

  const conversation = screen.getByRole("region", {
    name: "Espace de conversation",
  });
  const documentsPanel = screen.getByRole("complementary", {
    name: "Documents",
  });
  const formatsNote = within(documentsPanel).getByRole("note", {
      name: "Formats et limites",
    });
  const disclosure = formatsNote.querySelector("details")!;
  expect(disclosure.open).toBe(false);
  expect(within(formatsNote).getByText("Sans OCR")).toBeDefined();
  fireEvent.click(within(formatsNote).getByText("Formats et limites"));
  expect(disclosure.open).toBe(true);
  expect(
    within(documentsPanel).getByText(
      "PDF · DOCX · PPTX · XLSX · TXT · MD · CSV · 10 fichiers maximum · 10 Mio par fichier · 50 Mio au total",
    ),
  ).toBeDefined();
  expect(
    within(documentsPanel).getByText("PDF : texte sélectionnable requis. Aucun OCR intégré."),
  ).toBeDefined();
  expect(
    within(documentsPanel).getByText(/Les scans nécessitent une reconnaissance de texte préalable/),
  ).toBeDefined();
  expect(
    within(conversation).queryByText(
      "PDF · DOCX · PPTX · XLSX · TXT · MD · CSV · 10 fichiers maximum · 10 Mio par fichier · 50 Mio au total",
    ),
  ).toBeNull();
  expect(conversation.className).toContain("conversation-surface");
  expect(
    within(conversation).queryByRole("button", { name: "Choisir des documents" }),
  ).toBeNull();
  expect(within(conversation).getByTestId("rag-pipeline-visualizer")).toBeDefined();
});

test("allows manually switching the theme without persisting it", async () => {
  render(<Home />);

  const darkThemeButton = await screen.findByRole("button", {
    name: "Activer le thème sombre",
  });
  fireEvent.click(darkThemeButton);

  expect(document.documentElement.classList.contains("dark")).toBe(true);
  expect(document.documentElement.style.colorScheme).toBe("dark");
  expect(localStorage.getItem("docchat-theme")).toBeNull();

  fireEvent.click(
    screen.getByRole("button", { name: "Activer le thème clair" }),
  );
  expect(document.documentElement.classList.contains("dark")).toBe(false);
  expect(localStorage.getItem("docchat-theme")).toBeNull();
});

test("ignores an old saved dark preference and starts in light mode", async () => {
  localStorage.setItem("docchat-theme", "dark");

  render(<Home />);

  expect(
    await screen.findByRole("button", { name: "Activer le thème sombre" }),
  ).toBeDefined();
  expect(document.documentElement.classList.contains("dark")).toBe(false);
});

test("keeps chat unavailable until documents are processed", () => {
  render(<Home />);

  const composer = screen.getByRole("textbox", { name: "Votre message" });
  const sendButton = screen.getByRole("button", { name: "Envoyer le message" });

  expect(composer).toHaveProperty("disabled", true);
  expect(sendButton).toHaveProperty("disabled", true);
  expect(
    screen.getByText(
      "Ajoutez et préparez au moins un document pour démarrer le chat.",
    ),
  ).toBeDefined();
  expect(composer.getAttribute("aria-describedby")).toBe("composer-reason");
});

test("selects, validates, and removes multiple files before upload", () => {
  render(<Home />);

  const input = screen.getByLabelText("Sélectionner des documents sur cet appareil");
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
    screen.getByRole("heading", { name: "Votre sélection documentaire" }),
  ).toBeDefined();
  expect(screen.getByRole("list", { name: "Documents sélectionnés" })).toBeDefined();
  expect(screen.getByText("guide.pdf")).toBeDefined();
  expect(screen.getByText("legacy.doc")).toBeDefined();
  expect(screen.getByText("Ce format de fichier n’est pas pris en charge.")).toBeDefined();
  expect(screen.getByText("Sélectionné · non importé")).toBeDefined();
  expect(screen.getByRole("button", { name: "Ajouter des documents" })).toBeDefined();
  expect(
    screen.getByRole("button", { name: "Importer" }),
  ).toHaveProperty("disabled", true);

  fireEvent.click(screen.getByRole("button", { name: "Retirer legacy.doc" }));

  expect(screen.queryByText("legacy.doc")).toBeNull();
  expect(screen.getByLabelText("1 documents")).toBeDefined();
  expect(screen.getByRole("textbox", { name: "Votre message" })).toHaveProperty(
    "disabled",
    true,
  );
  expect(
    screen.getByText(
      "Importez les nouveaux documents pour actualiser les sources avant de discuter.",
    ),
  ).toBeDefined();
});

test("adds files by drag and drop and shows session limit errors", () => {
  render(<Home />);

  const dropZone = screen.getByRole("group", { name: "Zone de dépôt des documents" });
  const oversizedBatch = Array.from({ length: 11 }, (_, index) =>
    file(`${index}.pdf`, "application/pdf", 5 * 1024 * 1024),
  );

  fireEvent.dragEnter(dropZone, {
    dataTransfer: { files: oversizedBatch },
  });
  expect(screen.getByText("Déposez vos documents ici")).toBeDefined();

  fireEvent.drop(dropZone, {
    dataTransfer: { files: oversizedBatch },
  });

  expect(screen.getByLabelText("11 documents")).toBeDefined();
  expect(
    screen.getByText("Sélectionnez au maximum 10 fichiers."),
  ).toBeDefined();
  expect(
    screen.getByText("La sélection dépasse la limite totale de 50 Mio."),
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
  fireEvent.change(screen.getByLabelText("Sélectionner des documents sur cet appareil"), {
    target: { files: [file()] },
  });

  const uploadButton = screen.getByRole("button", {
    name: "Importer",
  });
  expect(uploadButton).toHaveProperty("disabled", false);

  fireEvent.click(uploadButton);
  fireEvent.click(uploadButton);

  expect(createAndUploadBatchMock).toHaveBeenCalledOnce();
  expect(screen.getByText("Création de l’espace documentaire")).toBeDefined();
  expect(
    screen.getByLabelText(
      /Propulsé par Gemini 3\.8 Flash\..*tokens en entrée.*raisonnement de niveau moyen\./u,
    ),
  ).toBeDefined();
  expect(screen.queryByText("Pipeline active")).toBeNull();
  expect(
    screen.queryByRole("button", { name: "Ajouter des documents" }),
  ).toBeNull();
  expect(screen.getByRole("button", { name: "Retirer guide.pdf" })).toHaveProperty(
    "disabled",
    true,
  );

  act(() => {
    publishUpdate({ index: 0, status: "uploading", progress: 42 });
  });

  const progress = screen.getByRole("progressbar", { name: "Importation : 42 %" });
  expect(progress.getAttribute("aria-valuenow")).toBe("42");
  expect(
    screen
      .getByText("guide.pdf")
      .closest("li")
      ?.querySelector('[data-operation="upload-transfer"]'),
  ).not.toBeNull();
  expect(screen.getByRole("textbox", { name: "Votre message" })).toHaveProperty(
    "disabled",
    true,
  );

  await act(async () => {
    publishUpdate({ index: 0, status: "uploaded", progress: 100 });
    finishUpload();
  });

  expect(
    screen.getByText("Importé · en attente de traitement"),
  ).toBeDefined();
  expect(screen.queryByText("Prêt")).toBeNull();
  expect(
    screen.getByText("Préparation des documents en cours. Le chat sera bientôt disponible."),
  ).toBeDefined();
  expect(screen.getByRole("button", { name: "Retirer guide.pdf" })).toHaveProperty(
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
  fireEvent.change(screen.getByLabelText("Sélectionner des documents sur cet appareil"), {
    target: { files: [file()] },
  });
  fireEvent.click(screen.getByRole("button", { name: "Importer" }));

  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toContain(
    "Les documents n’ont pas pu être importés. Réessayez.",
  );
  expect(screen.getByText("Sélectionné · non importé")).toBeDefined();
  expect(
    screen.getByRole("button", { name: "Importer" }),
  ).toHaveProperty("disabled", false);
  expect(screen.getByRole("textbox", { name: "Votre message" })).toHaveProperty(
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
  fireEvent.change(screen.getByLabelText("Sélectionner des documents sur cet appareil"), {
    target: { files: [file()] },
  });
  fireEvent.click(screen.getByRole("button", { name: "Importer" }));

  await waitFor(() => {
    expect(screen.getByText("Échec de l’importation")).toBeDefined();
  });
  expect(screen.getByText("Le fichier n’a pas pu être importé. Réessayez.")).toBeDefined();
  expect(
    screen.getByText("Un document n’a pas pu être traité. Réessayez ou supprimez-le pour accéder au chat."),
  ).toBeDefined();
  expect(screen.getByRole("button", { name: "Envoyer le message" })).toHaveProperty(
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
  fireEvent.change(screen.getByLabelText("Sélectionner des documents sur cet appareil"), {
    target: { files: [file()] },
  });
  fireEvent.click(screen.getByRole("button", { name: "Importer" }));

  expect(await screen.findByText("Lecture du texte")).toBeDefined();
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

  expect(await screen.findByText("Prêt")).toBeDefined();
  expect(screen.getByText("guide.pdf")).toBeDefined();
  expect(
    screen
      .getByText("guide.pdf")
      .closest("li")
      ?.querySelector('[data-operation="ready"]'),
  ).not.toBeNull();
  expect(
    await screen.findByRole("heading", { name: "Vos documents, prêts à éclairer vos décisions" }),
  ).toBeDefined();
  expect(screen.queryByText("Process replay")).toBeNull();
  expect(
    screen.getByLabelText(
      /Propulsé par Gemini 3\.8 Flash\..*tokens en entrée.*raisonnement de niveau moyen\./u,
    ),
  ).toBeDefined();
  expect(screen.getByRole("textbox", { name: "Votre message" })).toHaveProperty(
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
  fireEvent.change(screen.getByLabelText("Sélectionner des documents sur cet appareil"), {
    target: { files },
  });
  fireEvent.click(screen.getByRole("button", { name: "Importer" }));

  const guideCheckbox = await screen.findByRole("checkbox", {
    name: "Utiliser guide.pdf dans le chat",
  });
  const appendixCheckbox = screen.getByRole("checkbox", {
    name: "Utiliser appendix.pdf dans le chat",
  });

  expect(guideCheckbox).toHaveProperty("checked", true);
  expect(appendixCheckbox).toHaveProperty("checked", true);
  expect(screen.getByText(/Réponses fondées sur 2 documents prêts/)).toBeDefined();

  fireEvent.click(appendixCheckbox);

  expect(appendixCheckbox).toHaveProperty("checked", false);
  expect(guideCheckbox).toHaveProperty("disabled", true);
  expect(screen.getByText(/Réponses fondées sur 1 document prêt\./)).toBeDefined();
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
  fireEvent.change(screen.getByLabelText("Sélectionner des documents sur cet appareil"), {
    target: { files: [file()] },
  });
  fireEvent.click(screen.getByRole("button", { name: "Importer" }));

  const retryButton = await screen.findByRole("button", {
    name: "Réessayer guide.pdf",
  });
  fireEvent.click(retryButton);

  expect(screen.getByText("Nouvelle tentative…")).toBeDefined();
  expect(
    screen
      .getByText("guide.pdf")
      .closest("li")
      ?.querySelector('[data-operation="retrying"]'),
  ).not.toBeNull();
  expect(deleteDocumentMock).not.toHaveBeenCalled();

  await act(async () => finishRetry());

  expect(retryDocumentMock).toHaveBeenCalledWith("document-1");
  expect(await screen.findByText("Prêt")).toBeDefined();
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
  fireEvent.change(screen.getByLabelText("Sélectionner des documents sur cet appareil"), {
    target: { files: [file()] },
  });
  fireEvent.click(screen.getByRole("button", { name: "Importer" }));
  await screen.findByRole("button", { name: "Ajouter des documents" });

  const addedFile = file(
    "appendix.xlsx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  fireEvent.change(screen.getByLabelText("Sélectionner des documents sur cet appareil"), {
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
    name: "Utiliser appendix.xlsx dans le chat",
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
  fireEvent.change(screen.getByLabelText("Sélectionner des documents sur cet appareil"), {
    target: { files },
  });
  fireEvent.click(screen.getByRole("button", { name: "Importer" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "Supprimer guide.pdf" }),
  );

  await waitFor(() => {
    expect(screen.queryByText("guide.pdf")).toBeNull();
  });
  expect(deleteDocumentMock).toHaveBeenCalledWith("document-1");
  expect(
    screen.getByRole("checkbox", { name: "Utiliser appendix.pdf dans le chat" }),
  ).toHaveProperty("checked", true);
  expect(screen.getByText(/Réponses fondées sur 1 document prêt\./)).toBeDefined();
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
  fireEvent.change(screen.getByLabelText("Sélectionner des documents sur cet appareil"), {
    target: { files: [file()] },
  });
  fireEvent.click(screen.getByRole("button", { name: "Importer" }));

  const deleteButton = await screen.findByRole("button", {
    name: "Supprimer guide.pdf",
  });
  fireEvent.click(deleteButton);

  expect(screen.getByText("Suppression…")).toBeDefined();
  expect(screen.getByText("guide.pdf").closest("li")?.className).toContain(
    "document-row-deleting",
  );
  expect(
    screen.getByRole("heading", { name: "Vos documents, prêts à éclairer vos décisions" }),
  ).toBeDefined();
  expect(
    within(
      screen.getByRole("region", { name: "Espace de conversation" }),
    ).queryByRole("heading", { name: "Votre sélection documentaire" }),
  ).toBeNull();
  expect(screen.getByText("Actualisation des sources documentaires…")).toBeDefined();
  expect(screen.getByRole("textbox", { name: "Votre message" })).toHaveProperty(
    "disabled",
    true,
  );
  await act(async () => finishDeletion());

  expect(deleteDocumentMock).toHaveBeenCalledWith("document-1");
  expect(
    screen.getByRole("heading", { name: "Ajoutez vos documents" }),
  ).toBeDefined();
  expect(
    screen.getByRole("button", { name: "Choisir des documents" }),
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
  fireEvent.change(screen.getByLabelText("Sélectionner des documents sur cet appareil"), {
    target: { files: [file()] },
  });
  fireEvent.click(screen.getByRole("button", { name: "Importer" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "Supprimer guide.pdf" }),
  );

  expect(
    await screen.findByText("L’action n’a pas pu être effectuée. Réessayez."),
  ).toBeDefined();
  expect(screen.getByText("guide.pdf")).toBeDefined();
});
