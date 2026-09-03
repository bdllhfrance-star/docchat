import { describe, expect, test } from "vitest";

import {
  extractGeneralAiRedirect,
  GENERAL_AI_DESTINATIONS,
  GENERAL_AI_REDIRECT_MARKER,
  linkTrustedGeneralAiNames,
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

  test("recovers a clear model-written redirect when the marker is missing", () => {
    const text =
      "Smartly.ai is dedicated to document analysis. For general knowledge topics, I recommend using general conversational assistants such as ChatGPT, Claude, or Gemini.";

    expect(extractGeneralAiRedirect(text)).toEqual({
      text,
      showDestinations: true,
    });
  });

  test("does not mistake a document recommendation for a product redirect", () => {
    const text =
      "The document recommends ChatGPT, Claude, or Gemini for general knowledge topics [1].";

    expect(extractGeneralAiRedirect(text)).toEqual({
      text,
      showDestinations: false,
    });
  });

  test("turns trusted assistant names into allowlisted Markdown links", () => {
    expect(
      linkTrustedGeneralAiNames(
        "Use ChatGPT, Claude, or Gemini. Keep `ChatGPT` literal.",
      ),
    ).toBe(
      "Use [ChatGPT](https://chatgpt.com/), [Claude](https://claude.ai/), or [Gemini](https://gemini.google.com/). Keep `ChatGPT` literal.",
    );
  });
});
