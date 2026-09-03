export type ChatTurnMode =
  | "app_help"
  | "conversation"
  | "grounded"
  | "restricted"
  | "safe_system";

export type ChatLanguage = "ar" | "en" | "fr";

const conversationalTurns = [
  /^(?:hi|hello|hey|hi there|hello there|good (?:morning|afternoon|evening))$/iu,
  /^(?:i(?:'m| am) just saying (?:hi|hello)|just saying (?:hi|hello))$/iu,
  /^(?:how are you|who are you)$/iu,
  /^(?:thanks|thank you|thanks a lot|okay|ok|great|cool|perfect|goodbye|bye)$/iu,
  /^(?:sorry|no worries|haha+|h{3,}|lol)$/iu,
  /^(?:(?:why are you|you(?:'re| are)|that (?:was|is)) rude|don't be rude)$/iu,
  /^(?:bonjour|bonsoir|salut|coucou)$/iu,
  /^(?:je (?:dis|disais) juste (?:bonjour|salut)|je voulais juste dire (?:bonjour|salut))$/iu,
  /^(?:ça va|comment (?:vas-tu|allez-vous)|qui es-tu)$/iu,
  /^(?:merci|merci beaucoup|d'accord|compris|parfait|super|au revoir)$/iu,
  /^(?:désolé|pardon|pas de souci|haha+|h{3,})$/iu,
  /^(?:(?:pourquoi es-tu|tu es|c'était) impoli|ne sois pas impoli)$/iu,
  /^(?:salam|مرحبا|أهلا|السلام عليكم|شكرا|كيف حالك|من أنت|مع السلامة|ه{3,})$/iu,
] as const;

const safeSystemTurns = [
  /^(?:what(?:'s| is) (?:today(?:'s)? date|the date today)|what day is (?:it|today)|today(?:'s)? date)$/iu,
  /^(?:quelle est la date d'aujourd'hui|quel jour sommes-nous|on est quel jour|la date d'aujourd'hui)$/iu,
  /^(?:ما تاريخ اليوم|ما هو تاريخ اليوم|ما هو اليوم|أي يوم نحن)$/iu,
] as const;

const publicHelpTurns = [
  /^(?:what can you do|que peux-tu faire|ماذا يمكنك أن تفعل)$/iu,
  /\b(?:how|where|can i|what happens if)\b.{0,80}\b(?:upload|add|remove|delete|retry|replace|file|document|citation|source|chat|ask)\b/iu,
  /\b(?:supported formats?|which (?:file )?formats? are supported|file limits?|upload limits?|how does (?:this|the) app work)\b/iu,
  /\b(?:comment|où|puis-je|que se passe-t-il si)\b.{0,80}\b(?:ajouter|charger|téléverser|supprimer|retirer|réessayer|remplacer|fichier|document|citation|source|chat|question)\b/iu,
  /\b(?:formats? (?:acceptés|supportés)|limites? (?:de fichiers?|d'upload)|comment fonctionne (?:cette|l')application)\b/iu,
  /(?:كيف|أين|هل يمكنني).{0,80}(?:رفع|إضافة|حذف|إزالة|إعادة|ملف|مستند|مصدر|اقتباس|سؤال)/u,
] as const;

const directInjectionTurns = [
  /\b(?:ignore|disregard|forget|override)\b.{0,60}\b(?:previous|prior|system|developer|hidden)\b.{0,30}\b(?:instruction|prompt|message|rule)s?\b/iu,
  /\b(?:jailbreak|prompt injection|developer message|system prompt|hidden prompt|chain of thought)\b/iu,
  /(?:تجاهل|انسَ).{0,60}(?:التعليمات|القواعد|النظام)/u,
] as const;

const internalProductTurns = [
  /\b(?:reveal|show|print|repeat|give|expose|extract)\b.{0,80}\b(?:api key|secret|token|password|environment variable|system prompt|developer message|source code|configuration)\b/iu,
  /\b(?:how (?:are you|is (?:this|the) app) (?:built|implemented|deployed)|what (?:is|are) (?:your|this app(?:'s)?) (?:architecture|tech stack|backend|database|infrastructure|security|deployment|source code|model parameters?))\b/iu,
  /\b(?:montre|révèle|affiche|donne|extrais)\b.{0,80}\b(?:clé api|secret|jeton|mot de passe|variable d'environnement|prompt système|message développeur|code source|configuration)\b/iu,
  /\b(?:comment (?:es-tu|cette application est-elle) (?:construit|construite|déployée|implémentée)|quelle est (?:ton|l')architecture|quelle (?:base de données|infrastructure|technologie interne))\b/iu,
  /(?:اعرض|اكشف|أظهر|أعطني).{0,80}(?:مفتاح|سر|رمز|كلمة المرور|تعليمات النظام|الكود المصدري|الإعدادات)/u,
] as const;

function normalizeTurn(question: string): string {
  return question
    .trim()
    .replace(/[!?.،؛؟]+$/gu, "")
    .trim()
    .replace(/\s+/gu, " ");
}

function matchesAny(question: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(question));
}

export function detectChatLanguage(question: string): ChatLanguage {
  if (/\p{Script=Arabic}/u.test(question)) {
    return "ar";
  }

  if (
    /[àâçéèêëîïôùûüÿœ]/iu.test(question) ||
    /\b(?:bonjour|salut|merci|document|fichier|quelle|quel|comment|pourquoi|dans|selon|avec|sans|est-ce|aujourd'hui)\b/iu.test(
      question,
    )
  ) {
    return "fr";
  }

  return "en";
}

export function classifyChatTurn(question: string): ChatTurnMode {
  const normalized = normalizeTurn(question);

  if (!normalized) {
    return "grounded";
  }

  if (matchesAny(normalized, directInjectionTurns)) {
    return "restricted";
  }

  if (normalized.length <= 160 && matchesAny(normalized, safeSystemTurns)) {
    return "safe_system";
  }

  if (
    normalized.length <= 160 &&
    matchesAny(normalized, conversationalTurns)
  ) {
    return "conversation";
  }

  if (matchesAny(normalized, publicHelpTurns)) {
    return "app_help";
  }

  if (matchesAny(normalized, internalProductTurns)) {
    return "restricted";
  }

  return "grounded";
}
