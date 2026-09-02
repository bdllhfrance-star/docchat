import { z } from "zod";

const serverEnvSchema = z.object({
  MONGODB_URI: z.string().min(1),
  MONGODB_DATABASE: z.string().min(1),
  GOOGLE_GENERATIVE_AI_API_KEY: z.string().min(1),
  BLOB_STORE_ID: z.string().min(1),
  VERCEL_OIDC_TOKEN: z.string().min(1),
  BLOB_WEBHOOK_PUBLIC_KEY: z.string().min(1),
  UPSTASH_REDIS_REST_URL: z.string().url(),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1),
  APP_SECRET: z.string().min(32),
});

const sessionEnvSchema = z.object({
  APP_SECRET: z.string().min(32),
});

const databaseEnvSchema = z.object({
  MONGODB_URI: z.string().min(1),
  MONGODB_DATABASE: z.string().min(1),
});

const blobEnvSchema = z.object({
  BLOB_STORE_ID: z.string().min(1),
  VERCEL_OIDC_TOKEN: z.string().min(1),
  BLOB_WEBHOOK_PUBLIC_KEY: z.string().min(1),
});

const rateLimitEnvSchema = z.object({
  UPSTASH_REDIS_REST_URL: z.string().url(),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1),
  APP_SECRET: z.string().min(32),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;
export type SessionEnv = z.infer<typeof sessionEnvSchema>;
export type DatabaseEnv = z.infer<typeof databaseEnvSchema>;
export type BlobEnv = z.infer<typeof blobEnvSchema>;
export type RateLimitEnv = z.infer<typeof rateLimitEnvSchema>;

function formatEnvError(error: z.ZodError): Error {
  const variableNames = [
    ...new Set(error.issues.map((issue) => String(issue.path[0]))),
  ];

  return new Error(
    `Invalid server environment variables: ${variableNames.join(", ")}`,
  );
}

export function getServerEnv(
  values: Record<string, string | undefined> = process.env,
): ServerEnv {
  const result = serverEnvSchema.safeParse(values);

  if (!result.success) {
    throw formatEnvError(result.error);
  }

  return result.data;
}

export function getSessionEnv(
  values: Record<string, string | undefined> = process.env,
): SessionEnv {
  const result = sessionEnvSchema.safeParse(values);

  if (!result.success) {
    throw formatEnvError(result.error);
  }

  return result.data;
}

export function getDatabaseEnv(
  values: Record<string, string | undefined> = process.env,
): DatabaseEnv {
  const result = databaseEnvSchema.safeParse(values);

  if (!result.success) {
    throw formatEnvError(result.error);
  }

  return result.data;
}

export function getBlobEnv(
  values: Record<string, string | undefined> = process.env,
): BlobEnv {
  const result = blobEnvSchema.safeParse(values);

  if (!result.success) {
    throw formatEnvError(result.error);
  }

  return result.data;
}

export function getRateLimitEnv(
  values: Record<string, string | undefined> = process.env,
): RateLimitEnv {
  const result = rateLimitEnvSchema.safeParse(values);

  if (!result.success) {
    throw formatEnvError(result.error);
  }

  return result.data;
}
