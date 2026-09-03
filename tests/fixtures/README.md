# DocChat test fixtures

These fixtures are intentionally small, deterministic, and documented. They
exist only to verify extraction, retrieval, refusal, multilingual behavior, and
file validation.

## Licensed source PDFs

### French fixture

- Local file: `documents/wikipedia-contribution-guide-fr.pdf`
- Title: *Guide rapide pour contribuer à Wikipédia A+F 2020 Français*
- Author: Yhhue91
- Source file page:
  <https://commons.wikimedia.org/wiki/File:Guide_rapide_pour_contribuer_%C3%A0_Wikip%C3%A9dia_A%2BF_2020_Fran%C3%A7ais.pdf>
- Direct source:
  <https://upload.wikimedia.org/wikipedia/commons/c/c8/Guide_rapide_pour_contribuer_%C3%A0_Wikip%C3%A9dia_A%2BF_2020_Fran%C3%A7ais.pdf>
- License: CC BY-SA 4.0
- Accessed: 2026-09-02
- SHA-256:
  `4B4B626E15582842FE1253ABAB36D2364FC6A3DC8CBD21E6391FA70A5C385A8A`
- Verified properties: 13 pages, 116,369 bytes, native extractable text,
  unencrypted, no JavaScript.

### Arabic fixture

- Local file: `documents/wikipedia-classroom-booklet-ar.pdf`
- Title: *Reading Wikipedia in the Classroom - Booklet (Arabic)*
- Authors: Wikimedia Foundation Education team and contributors
- Source file page:
  <https://commons.wikimedia.org/wiki/File:Reading_Wikipedia_in_the_Classroom_-_Booklet_%28Arabic%29.pdf>
- Direct source:
  <https://upload.wikimedia.org/wikipedia/commons/2/2a/Reading_Wikipedia_in_the_Classroom_-_Booklet_%28Arabic%29.pdf>
- License: CC BY-SA 4.0
- Accessed: 2026-09-02
- SHA-256:
  `B0D6F503038CE9E661787C56AB8680DEA9E748E3A577C3473D9552FA3273DCE2`
- Verified properties: 10 pages, 3,073,424 bytes, native extractable Arabic
  text, unencrypted, no JavaScript.

The CC BY-SA 4.0 license text is available at
<https://creativecommons.org/licenses/by-sa/4.0/>. The fixtures are stored
without modification. Any modified redistribution must retain attribution,
link the license, identify changes, and use a compatible license.

Wikimedia names and logos are trademarks. Their inclusion in these test
documents does not imply endorsement of DocChat.

## Invalid fixtures

- `documents/empty.pdf`: empty file; expected to fail signature validation.
- `documents/invalid-signature.pdf`: UTF-8 text with a `.pdf` suffix; expected
  to fail signature validation.
- `documents/truncated.pdf`: incomplete PDF structure; expected to fail parsing.
- The oversized case is generated in the test temporary directory as
  `10 MiB + 1 byte`; it is not committed to avoid repository bloat.

## Locally authored multi-format fixtures

The small `*-smoke.*` files cover TXT, Markdown, CSV, DOCX, PPTX, and XLSX.
They contain deterministic, non-sensitive facts and source structures used by
the parser tests and the deployed cross-format retrieval smoke test. Expected
locations and answers are recorded in `manifest.json` and `evaluation.json`.

All locally authored fixture metadata and fixture content in this directory
are dedicated to the public domain under CC0 1.0.
