import { describe, expect, test } from "vitest";

import {
  extractGeneralAiRedirect,
  GENERAL_AI_DESTINATIONS,
  GENERAL_AI_REDIRECT_MARKER,
} from "./general-ai-redirect";

describe("general AI redirect presentation", () => {
  test("removes a completed marker and enables the trusted destinations", () => {
    expect(
      extractGeneralAiRedirect(
        `This question is outside document analysis.\n\n${GENERAL_AI_REDIRECT_MARKER}`,
      ),
    ).toEqual({
      text: "This question is outside document analysis.",
      showDestinations: true,
    });

    expect(GENERAL_AI_DESTINATIONS).toEqual([
      { id: "chatgpt", label: "ChatGPT", href: "https://chatgpt.com/" },
      { id: "claude", label: "Claude", href: "https://claude.ai/" },
      { id: "gemini", label: "Gemini", href: "https://gemini.google.com/" },
    ]);
  });

  test("hides a partial marker while it is streaming", () => {
    expect(
      extractGeneralAiRedirect("Use a general assistant.\n\n[[DOCCHAT_GEN"),
    ).toEqual({
      text: "Use a general assistant.",
      showDestinations: false,
    });
  });

  test("does not infer a redirect from ordinary assistant text", () => {
    expect(
      extractGeneralAiRedirect("The document compares ChatGPT, Claude and Gemini."),
    ).toEqual({
      text: "The document compares ChatGPT, Claude and Gemini.",
      showDestinations: false,
    });
  });
});
