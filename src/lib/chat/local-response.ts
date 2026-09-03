import {
  detectChatLanguage,
  type ChatLanguage,
  type ChatTurnMode,
} from "@/lib/chat/turn-mode";

type LocalChatTurnMode = Exclude<ChatTurnMode, "grounded">;

function socialMessage(question: string, language: ChatLanguage): string {
  const isRudenessReaction = /\b(?:rude|impoli)\b/iu.test(question);
  const isThanks =
    /\b(?:thanks|thank you|merci)\b/iu.test(question) || /شكرا/u.test(question);
  const isBye =
    /\b(?:bye|goodbye|au revoir)\b/iu.test(question) || /مع السلامة/u.test(question);

  if (language === "ar") {
    if (isRudenessReaction) {
      return "معك حق في الإشارة إلى ذلك، وأعتذر. يمكنني التفاعل معك بشكل طبيعي، وأنا هنا لمساعدتك في تحليل مستنداتك.";
    }

    if (isThanks) {
      return "على الرحب والسعة. أنا جاهز لأي سؤال حول مستنداتك.";
    }

    if (isBye) {
      return "إلى اللقاء! يمكنك العودة في أي وقت لمتابعة تحليل مستنداتك.";
    }

    return "مرحباً! أنا جاهز لمساعدتك في استكشاف مستنداتك وتحليلها.";
  }

  if (language === "fr") {
    if (isRudenessReaction) {
      return "Tu as raison de le signaler, désolé. Je peux échanger naturellement avec toi et je suis là pour t’aider à analyser tes documents.";
    }

    if (isThanks) {
      return "Avec plaisir. Je suis prêt pour tes questions sur les documents.";
    }

    if (isBye) {
      return "À bientôt ! Tu peux revenir quand tu veux pour poursuivre l’analyse de tes documents.";
    }

    return "Bonjour ! Je suis prêt à t’aider à explorer et analyser tes documents.";
  }

  if (isRudenessReaction) {
    return "You’re right to flag that—sorry. I can respond naturally, and I’m here to help you analyze your documents.";
  }

  if (isThanks) {
    return "You’re welcome. I’m ready for any questions about your documents.";
  }

  if (isBye) {
    return "See you! You can come back anytime to continue analyzing your documents.";
  }

  return "Hello! I’m ready to help you explore and analyze your documents.";
}

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
    case "conversation":
      return socialMessage(question, language);
    case "restricted":
      return restrictedMessage(language);
    case "safe_system":
      return safeDateMessage(now(), language);
  }
}
