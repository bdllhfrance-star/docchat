import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import {
  createSessionCookieValue,
  SESSION_COOKIE_NAME,
  SESSION_TTL_SECONDS,
} from "@/lib/session";

const cookieStore = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => cookieStore),
}));

import { ensureSession, requireSession } from "./session-request";

const secret = "a-test-secret-that-is-at-least-32-chars";
const sessionId = "5f36e79a-30b9-4866-9157-524d7de72af3";

describe("request sessions", () => {
  beforeEach(() => {
    vi.stubEnv("APP_SECRET", secret);
    cookieStore.get.mockReset();
    cookieStore.set.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test("creates an HTTP-only session when the cookie is absent", async () => {
    cookieStore.get.mockReturnValue(undefined);

    const result = await ensureSession();

    expect(result.created).toBe(true);
    expect(result.sessionId).toEqual(expect.any(String));
    expect(cookieStore.set).toHaveBeenCalledWith(
      SESSION_COOKIE_NAME,
      expect.any(String),
      {
        httpOnly: true,
        maxAge: SESSION_TTL_SECONDS,
        path: "/",
        sameSite: "lax",
        secure: false,
      },
    );
  });

  test("reuses a valid session without renewing it", async () => {
    cookieStore.get.mockReturnValue({
      value: createSessionCookieValue(secret, {
        sessionId,
        expiresAt: Math.floor(Date.now() / 1000) + 60,
      }),
    });

    await expect(ensureSession()).resolves.toEqual({
      sessionId,
      created: false,
    });
    expect(cookieStore.set).not.toHaveBeenCalled();
  });

  test("requires a valid signed cookie for existing resources", async () => {
    cookieStore.get.mockReturnValue({
      value: createSessionCookieValue(secret, {
        sessionId,
        expiresAt: Math.floor(Date.now() / 1000) + 60,
      }),
    });

    await expect(requireSession()).resolves.toBe(sessionId);

    cookieStore.get.mockReturnValue({ value: `${sessionId}.tampered` });
    await expect(requireSession()).resolves.toBeNull();
  });
});
