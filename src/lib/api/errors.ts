import type { ApiError, ApiErrorCode } from "@/types/api";

export function apiErrorResponse(
  status: number,
  requestId: string,
  code: ApiErrorCode,
  message: string,
  details?: Record<string, unknown>,
  headers?: HeadersInit,
): Response {
  const body: ApiError = {
    error: {
      code,
      message,
      requestId,
      ...(details ? { details } : {}),
    },
  };

  const responseHeaders = new Headers(headers);
  responseHeaders.set("cache-control", "no-store");
  responseHeaders.set("x-error-code", code);
  responseHeaders.set("x-request-id", requestId);

  return Response.json(body, { status, headers: responseHeaders });
}
