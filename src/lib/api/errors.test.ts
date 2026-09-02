import { describe, expect, test } from "vitest";

import { apiErrorResponse } from "./errors";

describe("API errors", () => {
  test("returns the shared error contract", async () => {
    const response = apiErrorResponse(
      400,
      "request-123",
      "INVALID_REQUEST",
      "Invalid request body.",
      { fields: ["files"] },
    );

    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-error-code")).toBe("INVALID_REQUEST");
    expect(response.headers.get("x-request-id")).toBe("request-123");
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INVALID_REQUEST",
        details: { fields: ["files"] },
        message: "Invalid request body.",
        requestId: "request-123",
      },
    });
  });
});
