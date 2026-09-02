export const GEMINI_CHAT_MODEL = {
  id: "gemini-3.7-flash",
  displayName: "Gemini 3.7 Flash",
  inputTokenLimit: 1_048_576,
  outputTokenLimit: 65_536,
  thinkingLevel: "medium",
  // Small guard for token-count differences and prompt formatting.
  inputSafetyMarginTokens: 16_384,
} as const;

export type NonDocumentTokenUsage = {
  system: number;
  history: number;
  question: number;
};

function assertTokenCount(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
}

export function getDocumentContextTokenBudget(
  usage: NonDocumentTokenUsage,
): number {
  assertTokenCount(usage.system, "system tokens");
  assertTokenCount(usage.history, "history tokens");
  assertTokenCount(usage.question, "question tokens");

  const nonDocumentTokens = usage.system + usage.history + usage.question;

  return Math.max(
    0,
    GEMINI_CHAT_MODEL.inputTokenLimit -
      GEMINI_CHAT_MODEL.inputSafetyMarginTokens -
      nonDocumentTokens,
  );
}
