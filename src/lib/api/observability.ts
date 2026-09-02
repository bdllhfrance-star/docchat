export type ApiOperation =
  | "batch.create"
  | "batch.documents.add"
  | "batch.read"
  | "chat.answer"
  | "document.delete"
  | "document.replace"
  | "document.retry"
  | "document.upload";

type LogWriter = Pick<Console, "error" | "info" | "warn">;

type ObserveApiRequestInput = {
  method: string;
  operation: ApiOperation;
  requestId: string;
  route: string;
};

type ObserveApiRequestOptions = {
  now?: () => number;
  writer?: LogWriter;
};

type StructuredApiLog = {
  timestamp: string;
  level: "error" | "info" | "warn";
  event: "api.request.completed" | "api.request.failed";
  requestId: string;
  method: string;
  route: string;
  operation: ApiOperation;
  status: number;
  durationMs: number;
  errorCode?: string;
};

function writeLog(log: StructuredApiLog, writer: LogWriter): void {
  writer[log.level](JSON.stringify(log));
}

export async function observeApiRequest(
  input: ObserveApiRequestInput,
  handler: () => Promise<Response>,
  options: ObserveApiRequestOptions = {},
): Promise<Response> {
  const now = options.now ?? Date.now;
  const writer = options.writer ?? console;
  const startedAt = now();

  try {
    const response = await handler();
    const completedAt = now();
    const durationMs = Math.max(0, completedAt - startedAt);
    const errorCode = response.headers.get("x-error-code") ?? undefined;
    const level = response.status >= 500
      ? "error"
      : response.status >= 400
        ? "warn"
        : "info";
    response.headers.set("x-request-id", input.requestId);
    writeLog(
      {
        timestamp: new Date(completedAt).toISOString(),
        level,
        event: "api.request.completed",
        ...input,
        status: response.status,
        durationMs,
        ...(errorCode ? { errorCode } : {}),
      },
      writer,
    );

    return response;
  } catch (error) {
    const failedAt = now();
    writeLog(
      {
        timestamp: new Date(failedAt).toISOString(),
        level: "error",
        event: "api.request.failed",
        ...input,
        status: 500,
        durationMs: Math.max(0, failedAt - startedAt),
        errorCode: "INTERNAL_ERROR",
      },
      writer,
    );
    throw error;
  }
}
