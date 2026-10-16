import type { DocumentSource } from "@/types/documents";

const errors: Record<string, string> = {
  EMPTY_DOCUMENT: "Ce document est vide.",
  EMPTY_PDF: "Ce PDF est vide.",
  INVALID_PDF: "Ce PDF est invalide ou endommagé.",
  ENCRYPTED_PDF: "Ce PDF est protégé par un mot de passe. Importez une copie non protégée.",
  NO_EXTRACTABLE_TEXT: "Aucun texte exploitable n’a été trouvé. Pour un document scanné, utilisez une version avec reconnaissance de texte.",
  PDF_TOO_MANY_PAGES: "Ce PDF dépasse la limite de 50 pages. Divisez-le en documents plus courts.",
  PDF_EXTRACTION_FAILED: "Le texte de ce PDF n’a pas pu être extrait. Essayez une autre copie.",
  INVALID_CSV: "Ce fichier CSV est invalide. Vérifiez ses lignes et ses séparateurs.",
  INVALID_OFFICE_FILE: "Ce fichier bureautique est invalide ou endommagé.",
  INVALID_TEXT_ENCODING: "L’encodage du texte n’est pas pris en charge. Enregistrez le fichier en UTF-8.",
  OFFICE_FILE_ENCRYPTED: "Ce fichier est protégé. Importez une copie non protégée.",
  OFFICE_ARCHIVE_LIMIT_EXCEEDED: "Ce fichier contient trop de données décompressées. Réduisez son contenu.",
  PPTX_TOO_MANY_SLIDES: "Cette présentation contient trop de diapositives. Divisez-la en plusieurs fichiers.",
  XLSX_TOO_MANY_CELLS: "Ce classeur contient trop de cellules. Réduisez les feuilles à analyser.",
  BLOB_NOT_FOUND: "Le fichier importé n’est plus disponible. Importez-le de nouveau.",
  BLOB_DOWNLOAD_FAILED: "Le fichier importé n’a pas pu être lu. Réessayez dans un instant.",
  BLOB_VALIDATION_FAILED: "Le contenu importé ne correspond pas au fichier attendu.",
  EMBEDDING_TIMEOUT: "La préparation de la recherche a pris trop de temps. Réessayez.",
  EMBEDDING_REQUEST_FAILED: "La préparation de la recherche est momentanément indisponible. Réessayez.",
  UNAUTHORIZED_SESSION: "Votre session a expiré. Actualisez la page, puis réessayez.",
  NOT_FOUND: "Le document ou l’espace demandé n’est plus disponible.",
  PAYLOAD_TOO_LARGE: "La taille autorisée est dépassée. Réduisez votre sélection ou votre message.",
  UNSUPPORTED_FILE_TYPE: "Ce format de fichier n’est pas pris en charge.",
  FILE_PROCESSING_FAILED: "Préparez tous les documents avant de démarrer le chat.",
  RATE_LIMITED: "Trop de requêtes. Patientez un instant avant de réessayer.",
  INVALID_REQUEST: "La demande n’a pas pu être traitée. Vérifiez votre sélection et réessayez.",
  PROVIDER_ERROR: "Le service est momentanément indisponible. Réessayez dans un instant.",
  INTERNAL_ERROR: "Une erreur est survenue. Réessayez dans un instant.",
};

// Keep provider diagnostics and raw JSON out of the interface, regardless of
// the language of the question. Model answers and document excerpts are intact.
export function frenchError(value: unknown, fallback: string): string {
  if (value && typeof value === "object" && "error" in value) {
    return frenchError(value.error, fallback);
  }
  const message = value instanceof Error
    ? value.message
    : typeof value === "string"
      ? value
      : value && typeof value === "object" && "message" in value
        ? String(value.message)
        : "";

  if (value && typeof value === "object" && "code" in value) {
    if (typeof value.code === "string" && errors[value.code]) {
      return errors[value.code];
    }
  }
  if (message.trim().startsWith("{")) {
    try { return frenchError(JSON.parse(message), fallback); } catch { return fallback; }
  }
  if (/no searchable passages/i.test(message)) {
    return "Vos documents sont prêts, mais aucun passage n’a pu être récupéré. Réessayez dans un instant.";
  }
  if (/daily quota|quota quotidien|الحصة اليومية/i.test(message)) {
    return "Le quota quotidien de Gemini est atteint. Réessayez après sa réinitialisation.";
  }
  if (/rate.limit|temporarily.*limit|limite temporairement|حداً مؤقتاً|too many/i.test(message)) {
    return errors.RATE_LIMITED;
  }
  if (/timeout|timed out|too long|trop de temps|وقتاً طويلاً/i.test(message)) {
    return "Le service a mis trop de temps à répondre. Réessayez.";
  }
  if (/fetch|network|réseau/i.test(message)) {
    return "Connexion interrompue. Vérifiez votre connexion et réessayez.";
  }
  return fallback;
}

export function frenchSourceLocation(source: DocumentSource): string {
  return source.label
    .replace(/\bSlide\b/g, "Diapositive")
    .replace(/\bSheet\b/g, "Feuille")
    .replace(/\bLines\b/g, "Lignes")
    .replace(/\bLine\b/g, "Ligne")
    .replace(/\bCells\b/g, "Cellules");
}
