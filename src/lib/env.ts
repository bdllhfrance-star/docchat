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

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export function getServerEnv(
  values: Record<string, string | undefined> = process.env,
): ServerEnv {
  const result = serverEnvSchema.safeParse(values);

  if (!result.success) {
    const variableNames = [
      ...new Set(result.error.issues.map((issue) => String(issue.path[0]))),
    ];

    throw new Error(
      `Invalid server environment variables: ${variableNames.join(", ")}`,
    );
  }

  return result.data;
}
