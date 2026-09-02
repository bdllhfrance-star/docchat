# DocChat

A full-stack document Q&A application built for the Smartly.ai technical exercise.
Users will be able to upload multiple document formats and receive streamed,
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

The application foundation is configured. PDF upload, processing, retrieval, and
chat features will be implemented incrementally.
