import { DocumentExtractionError } from "./parser-error";

const UTF8_BOM = [0xef, 0xbb, 0xbf] as const;
const UTF16_LE_BOM = [0xff, 0xfe] as const;
const UTF16_BE_BOM = [0xfe, 0xff] as const;

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  return signature.every((value, index) => bytes[index] === value);
}

function decodeUtf16BigEndian(bytes: Uint8Array): string {
  const length = bytes.byteLength - (bytes.byteLength % 2);
  const swapped = new Uint8Array(length);

  for (let index = 0; index < length; index += 2) {
    swapped[index] = bytes[index + 1];
    swapped[index + 1] = bytes[index];
  }

  return new TextDecoder("utf-16le", { fatal: true }).decode(swapped);
}

function containsTooManyControlCharacters(text: string): boolean {
  if (!text) {
    return false;
  }

  let controls = 0;

  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;

    if ((code < 32 && character !== "\n" && character !== "\r" && character !== "\t") || code === 127) {
      controls += 1;
    }
  }

  return controls / text.length > 0.01;
}

export function normalizeDocumentText(text: string): string {
  return text
    .replaceAll("\u0000", "")
    .replace(/\r\n?/gu, "\n")
    .replace(/[ \t]+\n/gu, "\n");
}

export function decodeDocumentText(content: ArrayBuffer): string {
  if (content.byteLength === 0) {
    throw new DocumentExtractionError(
      "EMPTY_DOCUMENT",
      "The document is empty.",
    );
  }

  const bytes = new Uint8Array(content);

  try {
    let text: string;

    if (startsWith(bytes, UTF8_BOM)) {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes.slice(3));
    } else if (startsWith(bytes, UTF16_LE_BOM)) {
      text = new TextDecoder("utf-16le", { fatal: true }).decode(bytes.slice(2));
    } else if (startsWith(bytes, UTF16_BE_BOM)) {
      text = decodeUtf16BigEndian(bytes.slice(2));
    } else {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    }

    if (text.includes("\u0000") || containsTooManyControlCharacters(text)) {
      throw new DocumentExtractionError(
        "INVALID_TEXT_ENCODING",
        "The file contains binary data instead of readable text.",
      );
    }

    return normalizeDocumentText(text);
  } catch (error) {
    if (error instanceof DocumentExtractionError) {
      throw error;
    }

    throw new DocumentExtractionError(
      "INVALID_TEXT_ENCODING",
      "The text encoding is not supported. Save the file as UTF-8 or UTF-16.",
    );
  }
}
