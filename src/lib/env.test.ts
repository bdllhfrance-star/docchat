import { describe, expect, test } from "vitest";

import { getServerEnv, getSessionEnv } from "./env";

const validEnv = {
  MONGODB_URI: "mongodb+srv://example.invalid/docchat",
  MONGODB_DATABASE: "docchat",
  GOOGLE_GENERATIVE_AI_API_KEY: "test-gemini-key",
  BLOB_STORE_ID: "store_test",
  VERCEL_OIDC_TOKEN: "test-oidc-token",
  BLOB_WEBHOOK_PUBLIC_KEY: "test-public-key",
  UPSTASH_REDIS_REST_URL: "https://example.invalid",
  UPSTASH_REDIS_REST_TOKEN: "test-upstash-token",
  APP_SECRET: "a-test-secret-that-is-at-least-32-chars",
};

describe("server environment", () => {
  test("returns validated server values", () => {
    expect(getServerEnv(validEnv)).toEqual(validEnv);
  });

  test("reports variable names without exposing values", () => {
    expect(() =>
      getServerEnv({
        ...validEnv,
        APP_SECRET: "short-and-sensitive",
        MONGODB_URI: undefined,
      }),
    ).toThrowError(
      "Invalid server environment variables: MONGODB_URI, APP_SECRET",
    );

    try {
      getServerEnv({ ...validEnv, APP_SECRET: "short-and-sensitive" });
    } catch (error) {
      expect(String(error)).not.toContain("short-and-sensitive");
    }
  });

  test("validates the session secret without requiring external services", () => {
    expect(getSessionEnv({ APP_SECRET: validEnv.APP_SECRET })).toEqual({
      APP_SECRET: validEnv.APP_SECRET,
    });
  });
});
