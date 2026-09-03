export type DocumentExtractionErrorCode =
  | "EMPTY_DOCUMENT"
  | "INVALID_CSV"
  | "INVALID_OFFICE_FILE"
  | "INVALID_TEXT_ENCODING"
  | "NO_EXTRACTABLE_TEXT"
  | "OFFICE_ARCHIVE_LIMIT_EXCEEDED"
  | "OFFICE_FILE_ENCRYPTED"
  | "PPTX_TOO_MANY_SLIDES"
  | "UNSUPPORTED_FILE_TYPE"
  | "XLSX_TOO_MANY_CELLS";

export class DocumentExtractionError extends Error {
  constructor(
    readonly code: DocumentExtractionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "DocumentExtractionError";
  }
}
