import { describe, expect, test } from "vitest";

import {
  GEMINI_CHAT_MODEL,
  getDocumentContextTokenBudget,
} from "./model-config";

describe("Gemini chat model configuration", () => {
  test("uses the official Gemini 3.7 Flash limits", () => {
    expect(GEMINI_CHAT_MODEL).toMatchObject({
      id: "gemini-3.7-flash",
      displayName: "Gemini 3.7 Flash",
      inputTokenLimit: 1_048_576,
      outputTokenLimit: 65_536,
      thinkingLevel: "medium",
    });
  });

  test("gives document context all remaining safe input space", () => {
    const budget = getDocumentContextTokenBudget({
      system: 2_000,
      history: 10_000,
      question: 500,
    });

    expect(budget).toBe(1_048_576 - 16_384 - 12_500);
  });

  test("never returns a negative budget", () => {
    expect(
      getDocumentContextTokenBudget({
        system: 1_048_576,
        history: 0,
        question: 0,
      }),
    ).toBe(0);
  });

  test("rejects invalid token counts", () => {
    expect(() =>
      getDocumentContextTokenBudget({
        system: -1,
        history: 0,
        question: 0,
      }),
    ).toThrow("system tokens");
  });
});
