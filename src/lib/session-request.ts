import { randomUUID } from "node:crypto";

import { cookies } from "next/headers";

import { getSessionEnv } from "@/lib/env";
import {
  createSessionCookieValue,
  readSessionId,
  SESSION_COOKIE_NAME,
  SESSION_TTL_SECONDS,
} from "@/lib/session";

export type RequestSession = {
  sessionId: string;
  created: boolean;
};

export async function ensureSession(): Promise<RequestSession> {
  const { APP_SECRET } = getSessionEnv();
  const cookieStore = await cookies();
  const currentSessionId = readSessionId(
    cookieStore.get(SESSION_COOKIE_NAME)?.value,
    APP_SECRET,
  );

  if (currentSessionId) {
    return { sessionId: currentSessionId, created: false };
  }

  const sessionId = randomUUID();
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;

  cookieStore.set(
    SESSION_COOKIE_NAME,
    createSessionCookieValue(APP_SECRET, { sessionId, expiresAt }),
    {
      httpOnly: true,
      maxAge: SESSION_TTL_SECONDS,
      path: "/",
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    },
  );

  return { sessionId, created: true };
}

export async function requireSession(): Promise<string | null> {
  const { APP_SECRET } = getSessionEnv();
  const cookieStore = await cookies();

  return readSessionId(
    cookieStore.get(SESSION_COOKIE_NAME)?.value,
    APP_SECRET,
  );
}
