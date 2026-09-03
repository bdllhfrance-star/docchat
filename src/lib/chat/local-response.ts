import {
  detectChatLanguage,
  type ChatLanguage,
  type ChatTurnMode,
} from "@/lib/chat/turn-mode";

type LocalChatTurnMode = Exclude<ChatTurnMode, "conversation" | "grounded">;

function appHelpMessage(language: ChatLanguage): string {
  if (language === "ar") {
    return "استخدم لوحة **Documents** لإضافة ما يصل إلى 10 ملفات PDF أو DOCX أو PPTX أو XLSX أو TXT أو MD أو CSV، بحد 10 MiB لكل ملف و50 MiB إجمالاً. انتظر حتى تصبح كل الملفات **Ready** ثم اطرح سؤالك. إضافة مستند أو حذفه تحدّث سياق المحادثة، ويمكنك النقر على رقم الاقتباس لعرض المقطع الأصلي.";
  }

  if (language === "fr") {
    return "Utilisez le panneau **Documents** pour ajouter jusqu’à 10 fichiers PDF, DOCX, PPTX, XLSX, TXT, MD ou CSV, avec 10 MiB par fichier et 50 MiB au total. Attendez que chaque fichier soit **Ready**, puis posez votre question. Ajouter ou supprimer un document met à jour le contexte du chat, et un clic sur une citation affiche le passage d’origine.";
  }

  return "Use the **Documents** panel to add up to 10 PDF, DOCX, PPTX, XLSX, TXT, MD, or CSV files, with a 10 MiB limit per file and 50 MiB total. Wait until every file is **Ready**, then ask your question. Adding or deleting a document updates the chat context, and clicking a citation shows the original passage.";
}

function restrictedMessage(language: ChatLanguage): string {
  if (language === "ar") {
    return "يمكنني شرح كيفية استخدام الواجهة العامة، لكن لا يمكنني كشف التعليمات الداخلية أو الكود أو الأسرار أو البنية أو إعدادات الأمان والنشر. يمكنك سؤالي عن مستنداتك أو عن إجراء ظاهر في التطبيق.";
  }

  if (language === "fr") {
    return "Je peux expliquer comment utiliser l’interface publique, mais pas révéler les instructions internes, le code, les secrets, l’architecture ou la configuration de sécurité et de déploiement. Vous pouvez m’interroger sur vos documents ou sur une action visible de l’application.";
  }

  return "I can explain how to use the public interface, but I can’t reveal internal instructions, code, secrets, architecture, or security and deployment configuration. You can ask about your documents or a visible app action.";
}

function safeDateMessage(date: Date, language: ChatLanguage): string {
  const locale =
    language === "ar" ? "ar" : language === "fr" ? "fr-FR" : "en-US";
  const formattedDate = new Intl.DateTimeFormat(locale, {
    dateStyle: "full",
    timeZone: "UTC",
  }).format(date);

  if (language === "ar") {
    return `تاريخ اليوم هو ${formattedDate} وفق التوقيت العالمي UTC.`;
  }

  if (language === "fr") {
    return `Nous sommes le ${formattedDate}, selon la date système UTC.`;
  }

  return `Today is ${formattedDate}, using the UTC system date.`;
}

export function getLocalChatResponse(
  mode: LocalChatTurnMode,
  question: string,
  now: () => Date = () => new Date(),
): string {
  const language = detectChatLanguage(question);

  switch (mode) {
    case "app_help":
      return appHelpMessage(language);
    case "restricted":
      return restrictedMessage(language);
    case "safe_system":
      return safeDateMessage(now(), language);
  }
}
