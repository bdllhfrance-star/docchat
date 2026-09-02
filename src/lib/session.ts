import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE_NAME = "docchat_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

const sessionVersion = "v1";
const sessionIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function signSession(
  sessionId: string,
  expiresAt: number,
  secret: string,
): string {
  return createHmac("sha256", secret)
    .update(`${sessionVersion}:${sessionId}:${expiresAt}`)
    .digest("base64url");
}

export function createSessionCookieValue(
  secret: string,
  options: { sessionId?: string; expiresAt?: number } = {},
): string {
  const sessionId = options.sessionId ?? randomUUID();
  const expiresAt =
    options.expiresAt ?? Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;

  if (!sessionIdPattern.test(sessionId)) {
    throw new Error("Session ID must be a UUID v4");
  }

  if (!Number.isSafeInteger(expiresAt) || expiresAt <= 0) {
    throw new Error("Session expiration must be a positive integer");
  }

  return `${sessionVersion}.${sessionId}.${expiresAt}.${signSession(
    sessionId,
    expiresAt,
    secret,
  )}`;
}

export function readSessionId(
  cookieValue: string | undefined,
  secret: string,
  now: number = Math.floor(Date.now() / 1000),
): string | null {
  if (!cookieValue || cookieValue.length > 256) {
    return null;
  }

  const [version, sessionId, expiresAtValue, providedSignature, extraPart] =
    cookieValue.split(".");
  const expiresAt = Number(expiresAtValue);

  if (
    version !== sessionVersion ||
    extraPart ||
    !sessionIdPattern.test(sessionId) ||
    !/^\d+$/.test(expiresAtValue) ||
    !Number.isSafeInteger(expiresAt) ||
    expiresAt <= now ||
    !providedSignature
  ) {
    return null;
  }

  const expectedSignature = signSession(sessionId, expiresAt, secret);
  const expectedBytes = Buffer.from(expectedSignature);
  const providedBytes = Buffer.from(providedSignature);

  if (expectedBytes.length !== providedBytes.length) {
    return null;
  }

  return timingSafeEqual(expectedBytes, providedBytes) ? sessionId : null;
}
