import { describe, expect, test, vi } from "vitest";

import { apiErrorResponse } from "./errors";
import { observeApiRequest } from "./observability";

function writer() {
  return {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  };
}

describe("API observability", () => {
  test("logs a fixed allowlist for rejected requests", async () => {
    const output = writer();
    const now = vi
      .fn<() => number>()
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(1_025);
    const response = await observeApiRequest(
      {
        method: "POST",
        operation: "chat.answer",
        requestId: "request-123",
        route: "/api/chat",
      },
      async () =>
        apiErrorResponse(
          429,
          "request-123",
          "RATE_LIMITED",
          "Do not log this message or a user's question.",
        ),
      { now, writer: output },
    );

    expect(response.headers.get("x-request-id")).toBe("request-123");
    expect(output.warn).toHaveBeenCalledOnce();
    const log = JSON.parse(output.warn.mock.calls[0][0] as string);
    expect(log).toEqual({
      timestamp: "1970-01-01T00:00:01.025Z",
      level: "warn",
      event: "api.request.completed",
      requestId: "request-123",
      method: "POST",
      route: "/api/chat",
      operation: "chat.answer",
      status: 429,
      durationMs: 25,
      errorCode: "RATE_LIMITED",
    });
    expect(JSON.stringify(log)).not.toContain("user's question");
    expect(output.info).not.toHaveBeenCalled();
    expect(output.error).not.toHaveBeenCalled();
  });

  test("logs successful responses at info level", async () => {
    const output = writer();
    const now = vi
      .fn<() => number>()
      .mockReturnValueOnce(2_000)
      .mockReturnValueOnce(2_010);

    await observeApiRequest(
      {
        method: "POST",
        operation: "batch.create",
        requestId: "request-456",
        route: "/api/batches",
      },
      async () => new Response(null, { status: 201 }),
      { now, writer: output },
    );

    expect(output.info).toHaveBeenCalledOnce();
    expect(output.warn).not.toHaveBeenCalled();
  });

  test("logs a safe internal code and rethrows unexpected failures", async () => {
    const output = writer();
    const failure = new Error("mongodb://user:secret@example.invalid");
    const now = vi
      .fn<() => number>()
      .mockReturnValueOnce(3_000)
      .mockReturnValueOnce(3_040);

    await expect(
      observeApiRequest(
        {
          method: "GET",
          operation: "batch.read",
          requestId: "request-789",
          route: "/api/batches/:batchId",
        },
        async () => {
          throw failure;
        },
        { now, writer: output },
      ),
    ).rejects.toBe(failure);

    const log = output.error.mock.calls[0][0] as string;
    expect(log).toContain('"errorCode":"INTERNAL_ERROR"');
    expect(log).not.toContain("mongodb://");
    expect(log).not.toContain("secret");
  });
});
