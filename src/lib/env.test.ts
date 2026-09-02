import { describe, expect, test } from "vitest";

import {
  getBlobEnv,
  getDatabaseEnv,
  getRateLimitEnv,
  getServerEnv,
  getSessionEnv,
} from "./env";

const validEnv = {
  MONGODB_URI: "mongodb+srv://example.invalid/docchat",
  MONGODB_DATABASE: "docchat",
  GOOGLE_GENERATIVE_AI_API_KEY: "test-gemini-key",
  BLOB_READ_WRITE_TOKEN: "test-blob-token",
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

  test("validates database variables independently", () => {
    expect(getDatabaseEnv(validEnv)).toEqual({
      MONGODB_DATABASE: validEnv.MONGODB_DATABASE,
      MONGODB_URI: validEnv.MONGODB_URI,
    });
  });

  test("validates private Blob variables independently", () => {
    expect(getBlobEnv(validEnv)).toEqual({
      BLOB_READ_WRITE_TOKEN: validEnv.BLOB_READ_WRITE_TOKEN,
    });
  });

  test("validates rate limiting variables independently", () => {
    expect(getRateLimitEnv(validEnv)).toEqual({
      APP_SECRET: validEnv.APP_SECRET,
      UPSTASH_REDIS_REST_TOKEN: validEnv.UPSTASH_REDIS_REST_TOKEN,
      UPSTASH_REDIS_REST_URL: validEnv.UPSTASH_REDIS_REST_URL,
    });
  });
});
