import { describe, expect, test } from "vitest";

import {
  assertRateLimit,
  createRateLimitIdentifier,
  RATE_LIMIT_POLICIES,
  rateLimitErrorResponse,
  RateLimitExceededError,
} from "./rate-limit";

const secret = "a-secure-test-secret-with-at-least-32-characters";

describe("rate limiting", () => {
  test("uses the intended limits for costly public operations", () => {
    expect(RATE_LIMIT_POLICIES).toEqual({
      upload: { requests: 30, window: "1 m" },
      retry: { requests: 5, window: "1 m" },
      chat: { requests: 10, window: "1 m" },
    });
  });

  test("creates a stable opaque identifier from the platform client address", () => {
    const request = new Request("http://localhost/api/chat", {
      headers: {
        "x-vercel-forwarded-for": "203.0.113.7",
        "x-forwarded-for": "198.51.100.4",
      },
    });
    const identifier = createRateLimitIdentifier(request, secret);

    expect(createRateLimitIdentifier(request, secret)).toBe(identifier);
    expect(identifier).not.toContain("203.0.113.7");
    expect(
      createRateLimitIdentifier(
        new Request("http://localhost/api/chat", {
          headers: { "x-vercel-forwarded-for": "203.0.113.8" },
        }),
        secret,
      ),
    ).not.toBe(identifier);
  });

  test("allows successful decisions and rejects blocked ones", async () => {
    await expect(
      assertRateLimit(async () => ({
        success: true,
        limit: 10,
        remaining: 9,
        reset: 61_000,
      })),
    ).resolves.toBeUndefined();

    await expect(
      assertRateLimit(async () => ({
        success: false,
        limit: 10,
        remaining: 0,
        reset: 61_000,
      })),
    ).rejects.toBeInstanceOf(RateLimitExceededError);
  });

  test("returns a retryable shared 429 response", async () => {
    const response = rateLimitErrorResponse(
      new RateLimitExceededError({
        success: false,
        limit: 10,
        remaining: 0,
        reset: 61_000,
      }),
      "request-123",
      1_000,
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(response.headers.get("x-ratelimit-limit")).toBe("10");
    expect(response.headers.get("x-ratelimit-remaining")).toBe("0");
    expect(response.headers.get("x-ratelimit-reset")).toBe("61");
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "RATE_LIMITED", requestId: "request-123" },
    });
  });
});
