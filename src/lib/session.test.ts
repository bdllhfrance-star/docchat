import { describe, expect, test } from "vitest";

import {
  createSessionCookieValue,
  readSessionId,
  SESSION_TTL_SECONDS,
} from "./session";

const secret = "a-test-secret-that-is-at-least-32-chars";
const sessionId = "5f36e79a-30b9-4866-9157-524d7de72af3";
const now = 1_800_000_000;
const expiresAt = now + SESSION_TTL_SECONDS;

describe("anonymous session cookie", () => {
  test("creates and verifies a signed UUID", () => {
    const value = createSessionCookieValue(secret, { sessionId, expiresAt });

    expect(readSessionId(value, secret, now)).toBe(sessionId);
  });

  test("rejects a modified session ID", () => {
    const value = createSessionCookieValue(secret, { sessionId, expiresAt });
    const tampered = value.replace(sessionId, crypto.randomUUID());

    expect(readSessionId(tampered, secret, now)).toBeNull();
  });

  test("rejects modified, expired, or malformed values", () => {
    const value = createSessionCookieValue(secret, { sessionId, expiresAt });

    expect(readSessionId(`${value}x`, secret, now)).toBeNull();
    expect(readSessionId(`${value}.extra`, secret, now)).toBeNull();
    expect(readSessionId("not-a-session", secret, now)).toBeNull();
    expect(readSessionId(value, secret, expiresAt)).toBeNull();
    expect(
      readSessionId(value, "a-different-secret-that-is-long-enough", now),
    ).toBeNull();
  });

  test("rejects an invalid caller-provided session ID", () => {
    expect(() =>
      createSessionCookieValue(secret, {
        sessionId: "predictable-id",
        expiresAt,
      }),
    ).toThrow("Session ID must be a UUID v4");
  });
});
