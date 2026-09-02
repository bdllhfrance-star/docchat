import { randomUUID } from "node:crypto";

import {
  issueSignedToken as issueVercelSignedToken,
  type IssuedSignedToken,
  type PutBlobResult,
} from "@vercel/blob";
import {
  handleUploadPresigned as handleVercelUploadPresigned,
  type HandleUploadPresignedBody,
  type HandleUploadPresignedOptions,
} from "@vercel/blob/client";

import { apiErrorResponse } from "@/lib/api/errors";
import {
  parseBlobCallbackPayload,
  parseBlobClientPayload,
  parseUploadFailureRequest,
} from "@/lib/uploads/blob-contract";
import {
  getAllowedMimeTypes,
  MAX_FILE_SIZE_BYTES,
} from "@/lib/uploads/validation";
import type { ApiErrorCode } from "@/types/api";
import type { DocumentRecord } from "@/types/persistence";

const maxUploadRequestBodyBytes = 32 * 1024;
const signedUploadTtlMilliseconds = 10 * 60 * 1000;

type UploadHandler = (options: HandleUploadPresignedOptions) => ReturnType<
  typeof handleVercelUploadPresigned
>;

type SignedTokenIssuer = (options: {
  pathname: string;
  operations: ["put"];
  validUntil: number;
  allowedContentTypes: string[];
  maximumSizeInBytes: number;
  oidcToken: string;
  storeId: string;
}) => Promise<IssuedSignedToken>;

export type BlobUploadDependencies = {
  blob: {
    oidcToken: string;
    storeId: string;
    webhookPublicKey: string;
  };
  completeDocumentUpload: (input: {
    sessionId: string;
    batchId: string;
    documentId: string;
    blobUrl: string;
  }) => Promise<DocumentRecord | null>;
  failDocumentUpload: (input: {
    sessionId: string;
    batchId: string;
    documentId: string;
    error: { code: string; message: string };
  }) => Promise<DocumentRecord | null>;
  findDocumentBySession: (
    sessionId: string,
    batchId: string,
    documentId: string,
  ) => Promise<DocumentRecord | null>;
  markDocumentUploading: (input: {
    sessionId: string;
    batchId: string;
    documentId: string;
  }) => Promise<DocumentRecord | null>;
  requireSession: () => Promise<string | null>;
  handleUpload?: UploadHandler;
  issueSignedToken?: SignedTokenIssuer;
  ingestDocument: (document: DocumentRecord) => Promise<void>;
  now?: () => number;
  requestId?: () => string;
};

class UploadRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    message: string,
  ) {
    super(message);
  }
}

async function parseRequestBody(
  request: Request,
): Promise<unknown> {
  const rawBody = await request.text();

  if (new TextEncoder().encode(rawBody).byteLength > maxUploadRequestBodyBytes) {
    throw new UploadRequestError(
      413,
      "PAYLOAD_TOO_LARGE",
      "The upload request is too large.",
    );
  }

  try {
    return JSON.parse(rawBody) as HandleUploadPresignedBody;
  } catch {
    throw new UploadRequestError(
      400,
      "INVALID_REQUEST",
      "The request body must be valid JSON.",
    );
  }
}

function assertUploadableDocument(
  document: DocumentRecord | null,
  pathname: string,
): asserts document is DocumentRecord {
  if (!document) {
    throw new UploadRequestError(404, "NOT_FOUND", "Document not found.");
  }

  if (document.blobPathname !== pathname) {
    throw new UploadRequestError(400, "INVALID_REQUEST", "Invalid upload path.");
  }

  if (document.status !== "queued" && document.status !== "uploading") {
    throw new UploadRequestError(
      409,
      "INVALID_REQUEST",
      "The document is not waiting for upload.",
    );
  }
}

function assertCompletedBlob(
  document: DocumentRecord | null,
  blob: PutBlobResult,
): asserts document is DocumentRecord {
  if (!document || document.blobPathname !== blob.pathname) {
    throw new UploadRequestError(404, "NOT_FOUND", "Document not found.");
  }

  if (!getAllowedMimeTypes(document.fileType).includes(blob.contentType)) {
    throw new UploadRequestError(
      415,
      "UNSUPPORTED_FILE_TYPE",
      "The uploaded content type is not allowed.",
    );
  }
}

export async function handleBlobUpload(
  request: Request,
  dependencies: BlobUploadDependencies,
): Promise<Response> {
  const requestId = (dependencies.requestId ?? randomUUID)();
  const handleUpload =
    dependencies.handleUpload ?? handleVercelUploadPresigned;
  const issueSignedToken =
    dependencies.issueSignedToken ?? issueVercelSignedToken;

  try {
    const body = await parseRequestBody(request);
    const uploadFailure = parseUploadFailureRequest(body);

    if (
      !uploadFailure &&
      typeof body === "object" &&
      body !== null &&
      "type" in body &&
      body.type === "docchat.upload-failed"
    ) {
      throw new UploadRequestError(
        400,
        "INVALID_REQUEST",
        "The upload failure request is invalid.",
      );
    }

    if (uploadFailure) {
      const sessionId = await dependencies.requireSession();

      if (!sessionId) {
        throw new UploadRequestError(
          401,
          "UNAUTHORIZED_SESSION",
          "A valid session is required.",
        );
      }

      const failed = await dependencies.failDocumentUpload({
        sessionId,
        batchId: uploadFailure.payload.batchId,
        documentId: uploadFailure.payload.documentId,
        error: {
          code: "UPLOAD_FAILED",
          message: "The browser upload did not complete.",
        },
      });

      if (!failed) {
        throw new UploadRequestError(
          409,
          "INVALID_REQUEST",
          "The upload failure could not be recorded.",
        );
      }

      return Response.json({
        type: "docchat.upload-failed",
        response: "ok",
      });
    }

    const response = await handleUpload({
      body: body as HandleUploadPresignedBody,
      request,
      webhookPublicKey: dependencies.blob.webhookPublicKey,
      getSignedToken: async (pathname, clientPayload, multipart) => {
        if (multipart) {
          throw new UploadRequestError(
            400,
            "INVALID_REQUEST",
            "Multipart upload is not supported for these file sizes.",
          );
        }

        const sessionId = await dependencies.requireSession();

        if (!sessionId) {
          throw new UploadRequestError(
            401,
            "UNAUTHORIZED_SESSION",
            "A valid session is required.",
          );
        }

        const payload = parseBlobClientPayload(clientPayload);
        const document = await dependencies.findDocumentBySession(
          sessionId,
          payload.batchId,
          payload.documentId,
        );
        assertUploadableDocument(document, pathname);

        const validUntil =
          (dependencies.now ?? Date.now)() + signedUploadTtlMilliseconds;
        const allowedContentTypes = [
          ...getAllowedMimeTypes(document.fileType),
        ];
        const maximumSizeInBytes = Math.min(
          document.size,
          MAX_FILE_SIZE_BYTES,
        );
        const uploading = await dependencies.markDocumentUploading({
          sessionId,
          batchId: payload.batchId,
          documentId: payload.documentId,
        });

        if (!uploading) {
          throw new UploadRequestError(
            409,
            "INVALID_REQUEST",
            "The document is no longer waiting for upload.",
          );
        }

        let token: IssuedSignedToken;

        try {
          token = await issueSignedToken({
            pathname,
            operations: ["put"],
            validUntil,
            allowedContentTypes,
            maximumSizeInBytes,
            oidcToken: dependencies.blob.oidcToken,
            storeId: dependencies.blob.storeId,
          });
        } catch (error) {
          await dependencies.failDocumentUpload({
            sessionId,
            batchId: payload.batchId,
            documentId: payload.documentId,
            error: {
              code: "UPLOAD_AUTHORIZATION_FAILED",
              message: "The private upload could not be authorized.",
            },
          });
          throw error;
        }

        return {
          token,
          urlOptions: {
            validUntil,
            allowedContentTypes,
            maximumSizeInBytes,
            addRandomSuffix: false,
            allowOverwrite: false,
            tokenPayload: JSON.stringify({
              sessionId,
              batchId: payload.batchId,
              documentId: payload.documentId,
            }),
          },
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        const payload = parseBlobCallbackPayload(tokenPayload);
        const document = await dependencies.findDocumentBySession(
          payload.sessionId,
          payload.batchId,
          payload.documentId,
        );
        assertCompletedBlob(document, blob);

        const completed = await dependencies.completeDocumentUpload({
          sessionId: payload.sessionId,
          batchId: payload.batchId,
          documentId: payload.documentId,
          blobUrl: blob.url,
        });

        if (!completed) {
          throw new UploadRequestError(
            409,
            "INVALID_REQUEST",
            "The completed upload could not be persisted.",
          );
        }

        await dependencies.ingestDocument(completed);
      },
    });

    return Response.json(response);
  } catch (error) {
    if (error instanceof UploadRequestError) {
      return apiErrorResponse(
        error.status,
        requestId,
        error.code,
        error.message,
      );
    }

    return apiErrorResponse(
      500,
      requestId,
      "INTERNAL_ERROR",
      "The upload request could not be processed.",
    );
  }
}
