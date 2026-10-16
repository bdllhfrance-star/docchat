import { describe, expect, test } from "vitest";
import { frenchError, frenchSourceLocation } from "./ui-french";

describe("French interface messages", () => {
  test("does not expose raw API JSON or provider diagnostics", () => {
    expect(frenchError(new Error(JSON.stringify({ error: { code: "PROVIDER_ERROR", message: "private diagnostic" } })), "Erreur")).toBe("Le service est momentanément indisponible. Réessayez dans un instant.");
    expect(frenchError(new Error("Blob English SDK error"), "Échec de l’importation.")).toBe("Échec de l’importation.");
  });
  test("keeps operational errors French for questions in any language", () => {
    expect(frenchError("Gemini took too long to respond.", "Erreur")).toContain("trop de temps");
    expect(frenchError("The Gemini free-tier daily quota has been reached.", "Erreur")).toContain("quota quotidien");
    expect(frenchError({ code: "UNAUTHORIZED_SESSION" }, "Erreur")).toContain("session");
  });
  test("localizes location labels without translating document titles", () => {
    expect(frenchSourceLocation({ label: "Slide 1 - Quarterly Review", slide: 1 })).toBe("Diapositive 1 - Quarterly Review");
    expect(frenchSourceLocation({ label: "Lines 1-7", lineStart: 1, lineEnd: 7 })).toBe("Lignes 1-7");
    expect(frenchSourceLocation({ label: "Page 2", page: 2 })).toBe("Page 2");
  });
  test("gives useful French explanations for extraction failures", () => {
    expect(frenchError({ code: "ENCRYPTED_PDF", message: "Password protected" }, "Erreur")).toContain("mot de passe");
    expect(frenchError({ code: "NO_EXTRACTABLE_TEXT", message: "No text" }, "Erreur")).toContain("reconnaissance de texte");
  });
});
