export const GENERAL_AI_REDIRECT_MARKER =
  "[[DOCCHAT_GENERAL_AI_REDIRECT]]";

export const GENERAL_AI_DESTINATIONS = [
  { id: "chatgpt", label: "ChatGPT", href: "https://chatgpt.com/" },
  { id: "claude", label: "Claude", href: "https://claude.ai/" },
  { id: "gemini", label: "Gemini", href: "https://gemini.google.com/" },
] as const;

export type GeneralAiRedirectPresentation = {
  text: string;
  showDestinations: boolean;
};

export function extractGeneralAiRedirect(
  value: string,
): GeneralAiRedirectPresentation {
  if (value.includes(GENERAL_AI_REDIRECT_MARKER)) {
    return {
      text: value.split(GENERAL_AI_REDIRECT_MARKER).join("").trim(),
      showDestinations: true,
    };
  }

  const possibleMarkerStart = value.lastIndexOf("[[");

  if (
    possibleMarkerStart >= 0 &&
    GENERAL_AI_REDIRECT_MARKER.startsWith(value.slice(possibleMarkerStart))
  ) {
    return {
      text: value.slice(0, possibleMarkerStart).trimEnd(),
      showDestinations: false,
    };
  }

  return { text: value, showDestinations: false };
}
