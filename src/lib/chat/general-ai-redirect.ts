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

const redirectRecommendationPatterns = [
  /\b(?:for general (?:conversation|knowledge|questions?|topics?)|outside (?:document|the document)|unrelated to (?:the )?(?:uploaded )?documents?)\b[\s\S]{0,320}\b(?:recommend|consider|suggest|try|use|visit)\b/iu,
  /\b(?:recommend|consider|suggest|try|use|visit)\b[\s\S]{0,240}\b(?:general (?:conversational )?(?:AI )?assistants?|for general (?:conversation|knowledge|questions?|topics?))\b/iu,
  /\b(?:pour (?:les |des )?(?:conversations?|connaissances?|questions?|sujets?) (?:générales?|généralistes?)|hors (?:du )?(?:document|contexte documentaire))\b[\s\S]{0,320}\b(?:recommande|utiliser|utilisez|essayer|essayez|consulter|consultez)\b/iu,
  /(?:للمحادثات العامة|للأسئلة العامة|خارج نطاق المستند)[\s\S]{0,320}(?:استخدم|جرّب|أنصح)/u,
] as const;

const productScopeBoundaryPatterns = [
  /\bSmartly\.ai\b[\s\S]{0,220}\b(?:dedicated|specialized|designed)\b/iu,
  /\b(?:I (?:cannot|can't|do not)|not able to)\b[\s\S]{0,180}\b(?:general (?:knowledge|conversation|questions?|topics?)|outside (?:the )?documents?)\b/iu,
  /\bSmartly\.ai\b[\s\S]{0,220}\b(?:dédié|spécialisé|conçu)\b/iu,
  /(?:Smartly\.ai)[\s\S]{0,220}(?:مخصص|متخصص|مصمم)/u,
] as const;

function containsTrustedDestinationList(value: string): boolean {
  return GENERAL_AI_DESTINATIONS.every((destination) =>
    value.toLocaleLowerCase().includes(destination.label.toLocaleLowerCase()),
  );
}

function isExplicitGeneralAiRecommendation(value: string): boolean {
  return (
    containsTrustedDestinationList(value) &&
    productScopeBoundaryPatterns.some((pattern) => pattern.test(value)) &&
    redirectRecommendationPatterns.some((pattern) => pattern.test(value))
  );
}

export function linkTrustedGeneralAiNames(value: string): string {
  return value
    .split(/(```[\s\S]*?```|~~~[\s\S]*?~~~)/gu)
    .map((block, blockIndex) => {
      if (blockIndex % 2 === 1) {
        return block;
      }

      return block
        .split(/(`[^`\n]*`)/gu)
        .map((part, partIndex) => {
          if (partIndex % 2 === 1) {
            return part;
          }

          return GENERAL_AI_DESTINATIONS.reduce(
            (linked, destination) =>
              linked.replace(
                new RegExp(`\\b${destination.label}\\b(?!\\]\\()`, "gu"),
                `[${destination.label}](${destination.href})`,
              ),
            part,
          );
        })
        .join("");
    })
    .join("");
}

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

  return {
    text: value,
    showDestinations: isExplicitGeneralAiRecommendation(value),
  };
}
