import type { ApiError, ApiErrorCode } from "@/types/api";

export function apiErrorResponse(
  status: number,
  requestId: string,
  code: ApiErrorCode,
  message: string,
  details?: Record<string, unknown>,
): Response {
  const body: ApiError = {
    error: {
      code,
      message,
      requestId,
      ...(details ? { details } : {}),
    },
  };

  return Response.json(body, { status });
}
