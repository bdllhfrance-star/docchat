import { z } from "zod";

import {
  MAX_FILES_PER_BATCH,
  normalizeFilename,
  validateBatchFiles,
} from "@/lib/uploads/validation";
import type {
  CreateBatchRequest,
  ValidatedBatchManifestFile,
} from "@/types/api";

const manifestFileSchema = z
  .object({
    clientId: z.string().uuid(),
    filename: z.string().trim().min(1).max(255),
    size: z.number().int().nonnegative(),
    mimeType: z.string().max(255),
  })
  .strict();

export const createBatchRequestSchema = z
  .object({
    files: z.array(manifestFileSchema).min(1).max(MAX_FILES_PER_BATCH),
  })
  .strict()
  .superRefine((request, context) => {
    const validation = validateBatchFiles(
      request.files.map((file) => ({
        name: file.filename,
        size: file.size,
        type: file.mimeType,
      })),
    );

    for (const error of validation.errors) {
      context.addIssue({
        code: "custom",
        message: error,
        path: ["files"],
      });
    }

    validation.files.forEach((file, index) => {
      for (const error of file.errors) {
        context.addIssue({
          code: "custom",
          message: error,
          path: ["files", index],
        });
      }
    });
  });

export type ValidatedBatchManifest = {
  files: ValidatedBatchManifestFile[];
};

export function parseBatchManifest(input: unknown): ValidatedBatchManifest {
  const request: CreateBatchRequest = createBatchRequestSchema.parse(input);
  const validation = validateBatchFiles(
    request.files.map((file) => ({
      name: file.filename,
      size: file.size,
      type: file.mimeType,
    })),
  );

  return {
    files: request.files.map((file, index) => ({
      ...file,
      filename: normalizeFilename(file.filename),
      fileType: validation.files[index].fileType!,
    })),
  };
}
