import { detectChatLanguage, type ChatLanguage } from "@/lib/chat/turn-mode";

export type ChatStreamFailureCode =
  | "AI_DAILY_QUOTA_EXCEEDED"
  | "AI_PROVIDER_ERROR"
  | "AI_RATE_LIMITED"
  | "AI_STREAM_TIMEOUT";

export type ChatStreamFailure = {
  code: ChatStreamFailureCode;
  message: string;
};

const messages: Record<
  ChatLanguage,
  Record<ChatStreamFailureCode, string>
> = {
  en: {
    AI_DAILY_QUOTA_EXCEEDED:
      "The Gemini free-tier daily quota has been reached. Please try again after the next quota reset.",
    AI_PROVIDER_ERROR:
      "Gemini could not generate the answer right now. Please try again.",
    AI_RATE_LIMITED:
      "Gemini is temporarily rate-limited. Please wait a moment and try again.",
    AI_STREAM_TIMEOUT:
      "Gemini took too long to respond. Please try again.",
  },
  fr: {
    AI_DAILY_QUOTA_EXCEEDED:
      "Le quota quotidien gratuit de Gemini est atteint. Réessayez après la prochaine réinitialisation du quota.",
    AI_PROVIDER_ERROR:
      "Gemini ne peut pas générer la réponse pour le moment. Réessayez.",
    AI_RATE_LIMITED:
      "Gemini limite temporairement les requêtes. Patientez un instant puis réessayez.",
    AI_STREAM_TIMEOUT:
      "Gemini a mis trop de temps à répondre. Réessayez.",
  },
  ar: {
    AI_DAILY_QUOTA_EXCEEDED:
      "تم بلوغ الحصة اليومية المجانية لـ Gemini. أعد المحاولة بعد إعادة تعيين الحصة التالية.",
    AI_PROVIDER_ERROR:
      "يتعذر على Gemini إنشاء الإجابة الآن. يرجى إعادة المحاولة.",
    AI_RATE_LIMITED:
      "يفرض Gemini حداً مؤقتاً على الطلبات. انتظر قليلاً ثم أعد المحاولة.",
    AI_STREAM_TIMEOUT:
      "استغرق Gemini وقتاً طويلاً للرد. يرجى إعادة المحاولة.",
  },
};

function errorSignals(error: unknown): string {
  const seen = new Set<unknown>();
  const signals: string[] = [];

  function visit(value: unknown, depth: number): void {
    if (depth > 4 || value === null || value === undefined || seen.has(value)) {
      return;
    }

    if (typeof value === "string" || typeof value === "number") {
      signals.push(String(value));
      return;
    }

    if (typeof value !== "object") {
      return;
    }

    seen.add(value);
    const record = value as Record<string, unknown>;

    for (const key of [
      "name",
      "message",
      "code",
      "reason",
      "statusCode",
      "responseBody",
      "cause",
      "lastError",
      "errors",
    ]) {
      visit(record[key], depth + 1);
    }
  }

  visit(error, 0);
  return signals.join(" ");
}

export function getChatStreamFailure(
  error: unknown,
  question: string,
): ChatStreamFailure {
  const signals = errorSignals(error);
  let code: ChatStreamFailureCode = "AI_PROVIDER_ERROR";

  if (
    /GenerateRequestsPerDay|generate_content_free_tier_requests/iu.test(signals)
  ) {
    code = "AI_DAILY_QUOTA_EXCEEDED";
  } else if (/\b429\b|RESOURCE_EXHAUSTED|rate.?limit|quota/iu.test(signals)) {
    code = "AI_RATE_LIMITED";
  } else if (/timeout|timed out/iu.test(signals)) {
    code = "AI_STREAM_TIMEOUT";
  }

  return {
    code,
    message: messages[detectChatLanguage(question)][code],
  };
}
