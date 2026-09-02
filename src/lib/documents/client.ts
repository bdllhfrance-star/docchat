import type { ApiError, RetryDocumentResponse } from "@/types/api";
import type { DocumentSummary } from "@/types/documents";

async function responseError(response: Response): Promise<Error> {
  try {
    const body = (await response.json()) as ApiError;
    return new Error(body.error.message);
  } catch {
    return new Error("The document action failed.");
  }
}

export async function retryDocument(
  documentId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<DocumentSummary> {
  const response = await fetchImpl(`/api/documents/${documentId}/retry`, {
    method: "POST",
  });

  if (!response.ok) {
    throw await responseError(response);
  }

  const body = (await response.json()) as RetryDocumentResponse;

  if (!body.document || body.document.id !== documentId) {
    throw new Error("The retry response is invalid.");
  }

  return body.document;
}

export async function deleteDocument(
  documentId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const response = await fetchImpl(`/api/documents/${documentId}`, {
    method: "DELETE",
  });

  if (!response.ok) {
    throw await responseError(response);
  }
}
