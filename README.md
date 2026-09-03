# DocChat

A full-stack document Q&A application built for the Smartly.ai technical exercise.
Users can upload multiple document formats and receive streamed,
source-grounded answers through a small Retrieval-Augmented Generation pipeline.

The project scope, user stories, architecture, delivery plan, and definition of
done are maintained in [the project reference](docs/PROJECT_REFERENCE.md).

## Local development

Requirements:

- Node.js 22 or newer
- pnpm

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

## Quality commands

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Run the first three checks together with `pnpm check`.

## Engineering approach

- Use one Next.js application for the UI and REST API.
- Prefer small, direct modules over speculative abstractions.
- Add infrastructure only when a product requirement needs it.
- Optimize measured bottlenecks instead of anticipated ones.
- Keep server secrets and document-processing logic outside the client bundle.

## Current status

The end-to-end upload, processing, retrieval, and streaming chat flow is
implemented for PDF, DOCX, PPTX, XLSX, TXT, Markdown, and CSV.

Each format is normalized into text blocks with a precise source location:

- PDF: page number
- DOCX: heading hierarchy, paragraphs, and tables by section
- PPTX: slide number, title, body text, and tables
- XLSX: sheet, headers, rows, formulas, dates, and cell range
- TXT: exact line ranges
- Markdown: heading hierarchy and line ranges
- CSV: detected delimiter, headers, records, and physical line ranges

Location metadata is included in document embeddings and supplied separately to
Gemini with retrieved text. This improves retrieval of small facts while keeping
the displayed excerpts clean and traceable.

Modern Office files are parsed locally as bounded OOXML archives. The parser
rejects unsafe paths, macros, encrypted or legacy containers, excessive archive
expansion, more than 100 PPTX slides, and more than 50,000 non-empty XLSX cells.
No paid parsing service or additional worker is required.
