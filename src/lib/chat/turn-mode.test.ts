import { describe, expect, test } from "vitest";

import { classifyChatTurn } from "./turn-mode";

describe("chat turn routing", () => {
  test.each([
    "hello",
    "Hello!",
    "I am just saying hello",
    "bonjour",
    "Merci beaucoup.",
    "مرحبا",
    "السلام عليكم",
  ])("routes the conversational turn %j without document retrieval", (turn) => {
    expect(classifyChatTurn(turn)).toBe("conversation");
  });

  test.each([
    "What does the document say?",
    "Hello, what experience does the CV mention?",
    "Résume le deuxième fichier",
    "merci de comparer les deux contrats",
    "ما هو المبلغ المذكور في الوثيقة؟",
  ])("keeps the document question %j grounded", (turn) => {
    expect(classifyChatTurn(turn)).toBe("grounded");
  });
});
