import { createHmac } from "node:crypto";

import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

import { apiErrorResponse } from "@/lib/api/errors";
import { getRateLimitEnv } from "@/lib/env";

export const RATE_LIMIT_POLICIES = {
  upload: { requests: 30, window: "1 m" },
  retry: { requests: 5, window: "1 m" },
  chat: { requests: 10, window: "1 m" },
} as const;

export type RateLimitScope = keyof typeof RATE_LIMIT_POLICIES;

export type RateLimitDecision = {
  success: boolean;
  limit: number;
  remaining: number;
  reset: number;
  reason?: "timeout" | "cacheBlock" | "denyList";
};

export type RateLimitCheck = () => Promise<RateLimitDecision>;

export class RateLimitExceededError extends Error {
  constructor(readonly decision: RateLimitDecision) {
    super("The request rate limit was exceeded.");
    this.name = "RateLimitExceededError";
  }
}

const blockedIdentifierCache = new Map<string, number>();
let rateLimiters: Partial<Record<RateLimitScope, Ratelimit>> = {};

function clientAddress(request: Request): string {
  const forwarded =
    request.headers.get("x-vercel-forwarded-for") ??
    request.headers.get("x-forwarded-for");

  return forwarded?.split(",", 1)[0].trim() || "local";
}

export function createRateLimitIdentifier(
  request: Request,
  secret: string,
): string {
  return createHmac("sha256", secret)
    .update(clientAddress(request))
    .digest("base64url");
}

function getRateLimiter(scope: RateLimitScope): Ratelimit {
  const existing = rateLimiters[scope];

  if (existing) {
    return existing;
  }

  const env = getRateLimitEnv();
  const redis = new Redis({
    url: env.UPSTASH_REDIS_REST_URL,
    token: env.UPSTASH_REDIS_REST_TOKEN,
  });
  const policy = RATE_LIMIT_POLICIES[scope];
  const limiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(policy.requests, policy.window),
    analytics: false,
    ephemeralCache: blockedIdentifierCache,
    prefix: `docchat:ratelimit:${scope}`,
    timeout: 1_000,
  });
  rateLimiters[scope] = limiter;

  return limiter;
}

export async function checkRequestRateLimit(
  request: Request,
  scope: RateLimitScope,
): Promise<RateLimitDecision> {
  const env = getRateLimitEnv();
  const identifier = createRateLimitIdentifier(request, env.APP_SECRET);

  return getRateLimiter(scope).limit(identifier);
}

export async function assertRateLimit(check?: RateLimitCheck): Promise<void> {
  if (!check) {
    return;
  }

  const decision = await check();

  if (!decision.success) {
    throw new RateLimitExceededError(decision);
  }
}

export function rateLimitErrorResponse(
  error: RateLimitExceededError,
  requestId: string,
  now = Date.now(),
): Response {
  const resetSeconds = Math.ceil(error.decision.reset / 1000);
  const retryAfterSeconds = Math.max(
    1,
    Math.ceil((error.decision.reset - now) / 1000),
  );

  return apiErrorResponse(
    429,
    requestId,
    "RATE_LIMITED",
    "Too many requests. Please try again shortly.",
    undefined,
    {
      "retry-after": String(retryAfterSeconds),
      "x-ratelimit-limit": String(error.decision.limit),
      "x-ratelimit-remaining": String(error.decision.remaining),
      "x-ratelimit-reset": String(resetSeconds),
    },
  );
}

export function resetRateLimitersForTests(): void {
  rateLimiters = {};
  blockedIdentifierCache.clear();
}
