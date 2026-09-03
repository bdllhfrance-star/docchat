export type ChatTurnMode = "conversation" | "grounded";

const conversationalTurns = [
  /^(?:hi|hello|hey|hi there|hello there|good (?:morning|afternoon|evening))$/iu,
  /^(?:i(?:'m| am) just saying (?:hi|hello)|just saying (?:hi|hello))$/iu,
  /^(?:how are you|who are you|what can you do)$/iu,
  /^(?:thanks|thank you|thanks a lot|okay|ok|great|cool|perfect|goodbye|bye)$/iu,
  /^(?:bonjour|bonsoir|salut|coucou)$/iu,
  /^(?:je (?:dis|disais) juste (?:bonjour|salut)|je voulais juste dire (?:bonjour|salut))$/iu,
  /^(?:ça va|comment (?:vas-tu|allez-vous)|qui es-tu|que peux-tu faire)$/iu,
  /^(?:merci|merci beaucoup|d'accord|compris|parfait|super|au revoir)$/iu,
  /^(?:salam|مرحبا|أهلا|السلام عليكم|شكرا|كيف حالك|من أنت|مع السلامة)$/iu,
] as const;

export function classifyChatTurn(question: string): ChatTurnMode {
  const normalized = question
    .trim()
    .replace(/[!?.،؛]+$/gu, "")
    .replace(/\s+/gu, " ");

  if (!normalized || normalized.length > 160) {
    return "grounded";
  }

  return conversationalTurns.some((pattern) => pattern.test(normalized))
    ? "conversation"
    : "grounded";
}
