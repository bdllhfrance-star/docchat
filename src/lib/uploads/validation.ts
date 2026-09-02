import type { SupportedFileType } from "@/types/documents";

export const MAX_FILES_PER_BATCH = 10;
export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
export const MAX_BATCH_SIZE_BYTES = 50 * 1024 * 1024;

const fileTypesByExtension = {
  pdf: {
    fileType: "pdf",
    mimeTypes: ["application/pdf"],
  },
  docx: {
    fileType: "docx",
    mimeTypes: [
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ],
  },
  pptx: {
    fileType: "pptx",
    mimeTypes: [
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ],
  },
  xlsx: {
    fileType: "xlsx",
    mimeTypes: [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ],
  },
  txt: {
    fileType: "txt",
    mimeTypes: ["text/plain"],
  },
  md: {
    fileType: "md",
    mimeTypes: ["text/markdown", "text/plain"],
  },
  csv: {
    fileType: "csv",
    mimeTypes: ["text/csv", "text/plain", "application/vnd.ms-excel"],
  },
} as const satisfies Record<
  string,
  { fileType: SupportedFileType; mimeTypes: readonly string[] }
>;

export type FileValidationErrorCode =
  | "EMPTY_FILE"
  | "FILE_TOO_LARGE"
  | "MIME_TYPE_MISMATCH"
  | "UNSAFE_FILENAME"
  | "UNSUPPORTED_FILE_TYPE";

export type BatchValidationErrorCode =
  | "BATCH_TOO_LARGE"
  | "TOO_MANY_FILES";

export type FileLike = {
  name: string;
  size: number;
  type: string;
};

export type ValidatedFile<TFile extends FileLike = FileLike> = {
  file: TFile;
  fileType: SupportedFileType | null;
  errors: FileValidationErrorCode[];
};

export type BatchValidationResult<TFile extends FileLike = FileLike> = {
  files: ValidatedFile<TFile>[];
  errors: BatchValidationErrorCode[];
  isValid: boolean;
  totalSize: number;
};

const unsafeFilenameCharacters =
  /[\/\\\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u;

export function normalizeFilename(filename: string): string {
  return filename.trim().normalize("NFC");
}

export function isSafeFilename(filename: string): boolean {
  const normalizedFilename = normalizeFilename(filename);

  return (
    normalizedFilename.length > 0 &&
    normalizedFilename.length <= 255 &&
    !unsafeFilenameCharacters.test(normalizedFilename)
  );
}

function getExtension(filename: string): string {
  const dotIndex = filename.lastIndexOf(".");

  return dotIndex === -1 ? "" : filename.slice(dotIndex + 1).toLowerCase();
}

export function getAllowedMimeTypes(
  fileType: SupportedFileType,
): readonly string[] {
  return fileTypesByExtension[fileType].mimeTypes;
}

export function validateBatchFiles<TFile extends FileLike>(
  files: readonly TFile[],
): BatchValidationResult<TFile> {
  const totalSize = files.reduce((sum, file) => sum + file.size, 0);
  const batchErrors: BatchValidationErrorCode[] = [];

  if (files.length > MAX_FILES_PER_BATCH) {
    batchErrors.push("TOO_MANY_FILES");
  }

  if (totalSize > MAX_BATCH_SIZE_BYTES) {
    batchErrors.push("BATCH_TOO_LARGE");
  }

  const validatedFiles = files.map((file) => {
    const normalizedFilename = normalizeFilename(file.name);
    const extension = getExtension(normalizedFilename);
    const config = fileTypesByExtension[
      extension as keyof typeof fileTypesByExtension
    ];
    const errors: FileValidationErrorCode[] = [];

    if (!isSafeFilename(file.name)) {
      errors.push("UNSAFE_FILENAME");
    }

    if (!config) {
      errors.push("UNSUPPORTED_FILE_TYPE");
    }

    if (file.size === 0) {
      errors.push("EMPTY_FILE");
    } else if (file.size > MAX_FILE_SIZE_BYTES) {
      errors.push("FILE_TOO_LARGE");
    }

    if (config && file.type) {
      const allowedMimeTypes: readonly string[] = config.mimeTypes;

      if (!allowedMimeTypes.includes(file.type)) {
        errors.push("MIME_TYPE_MISMATCH");
      }
    }

    return {
      file,
      fileType: config?.fileType ?? null,
      errors,
    };
  });

  return {
    files: validatedFiles,
    errors: batchErrors,
    isValid:
      batchErrors.length === 0 &&
      validatedFiles.every((file) => file.errors.length === 0) &&
      validatedFiles.length > 0,
    totalSize,
  };
}
