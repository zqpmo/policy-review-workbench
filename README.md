# policy-review-workbench

> 中文版见 [README.zh-CN.md](./README.zh-CN.md)

**Offline policy-review workbench** — a layered state machine for **parse → compare → QC → export**. The main chain needs **no network**; optional local n8n/Dify hooks stay stubbed until you wire them.

[![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Tests](https://img.shields.io/badge/tests-7%20suites-orange)](#testing)

## Why this exists

Policy/regulation review needs a **repeatable chain**: ingest clauses, compare against upper-level / peer / prior versions, run QC gates, then export a report — without letting a draft leak as “approved”. This workbench encodes that as:

- **Parse layer** — file → structured clauses (async jobs; failure flags block the chain). **Stub only — does not read file bodies.**
- **Flow matrix** — pure state machine: which actions are legal next (compare / QC / export / hold)
- **Compare & QC layer** — contract-shaped payload (Dify-compatible stub; swap in a real HTTP backend later)
- **Export layer (Node module)** — gated **plain-text report + CSV + JSON + metadata** drafts (not binary `.docx`); blocked until status allows

**Safety default:** **local Mock** — no network, **no file-body parsing**. Webhook/Dify fields are optional (`http://127.0.0.1:...`). No OA, no production credentials.

## Quick start

```bash
# Open the UI (self-contained single HTML + progress module)
# double-click workbench.html  or:
start workbench.html          # Windows
open workbench.html           # macOS

# Run all offline tests (no network)
node test-parse-layer.js
node test-flow-matrix.js
node test-dify-export.js
node test-export-source.js     # result source + CSV header + metadata.json
node test-progress-restore.js  # legacy exportable draft cannot restore as exportable
node test-case-acceptance.js   # writes CASE_ACCEPTANCE_RESULT.json
node test-case-b.js            # merges CASE-B into the result file
```

Expected after the **full sequence** (acceptance then CASE-B): each script exits 0; scorecard shows `CASE-A/B/C/D = pass`, `acceptance: "pass"`, `p1_open: 0`.

If you run **only** `test-case-b.js` on a fresh tree, the scorecard is **partial** (`CASE-B` only, `ok: false`, notes list what was scored) — it will **not** claim A/B/C/D all passed.

## Architecture

| File | Role |
|---|---|
| `workbench.html` | Single-file UI (styles + app JS inline) |
| `policy-review-progress.js` | Save/restore contract (form only; never results) — shared by UI + tests |
| `policy-review-parse-layer.js` | Parse stub: detect type, async job status, core-basis failures |
| `policy-review-flow-matrix.js` | Pure state machine → enabled/disabled actions |
| `policy-review-dify-layer.js` | Build compare/QC input contract (`dify_io_v0.1`) + stub results |
| `policy-review-export-layer.js` | Export gate, source-aware disclaimers, metadata.json, partial failure |
| `test-*.js` | Node unit + CASE acceptance suites |
| `CASE_ACCEPTANCE_RESULT.json` | Last acceptance scorecard |

### Known limitations (honest list)

- **Architecture prototype / offline acceptance harness** — not a production compliance system.
- **Parse layer is a stub** (async job simulation + failure flags). It does **not** extract text from real PDF/DOCX. The UI shows a persistent **demo banner** stating mock results are not analysis of your document.
- **Two export paths — do not confuse them:**
  - **Node `export-layer` module** → `.txt` report + `.csv` + `.json` + **`metadata.json`** (source + disclaimer). CSV first line is a **standard header** (no `#` prefix row).
  - **UI buttons** (`Export report (.doc)` / `Export table (.xls)`) → **HTML-wrapped downloads** with `.doc` / `.xls` extensions (Word/Excel-compatible markup), **not** native OOXML binaries.
- **Result source is recorded when results are produced** (`local_mock` | `n8n` | `unknown`), not from the UI mode toggle at export time. Export disclaimers follow that recorded source (n8n results are not labeled as Mock).
- **`metadata.json` is a companion file.** If a CSV or QC JSON is forwarded alone, the source disclaimer does **not** travel with it — keep `metadata.json` alongside, or re-attach source yourself.
- **Save progress persists form/metadata only** — not compare/report/QC/`result_source`. After refresh you must re-run **Start review** before export (export-ready is never restored).
- **Default mode is local Mock** — no HTTP. Choosing **n8n mode** and filling a Webhook URL will `fetch` your payload (document metadata / clause JSON) to **that URL you control**; leave empty to stay offline.
- **Dify layer is a contract stub** (`dify_io_v0.1`); swap in a real backend only if you wire it yourself.
- Unit + CASE tests are **offline only** (no real n8n/Dify/OA). They do not prove end-to-end backend behavior. Much UI logic is **inline in `workbench.html`**; restore rules are shared via `policy-review-progress.js`.
- Exported artifacts are **drafts** until human review; the tool does not issue final legal/audit determinations. **UI and module exports embed a source/mock disclaimer** inside the file so it travels with the download.

### Chain gates (summary)

1. **Parse** must complete; core-basis parse failure → `parse_flagged` → compare/export **blocked**, reparse allowed.
2. **Warnings** (low confidence, missing history) do **not** hard-block — flag only.
3. **Export** requires explicit allow + status `ready_for_export`; QC JSON / CSV / report artifacts are named with case id + timestamp.
4. Offline acceptance cases: **A** success main chain, **B** warning path, **C** parse core fail, **D** export gate/retry.

## Optional backends (not required)

The UI defaults to **local Mock** (no network). Optional fields:

- **n8n Webhook** — if you select n8n mode and set a URL, the browser will `POST` the case payload to **that URL**. Only enable when you trust the endpoint.
- **Dify-compatible contract** — keep the JSON shape of `buildDifyInput()` in `policy-review-dify-layer.js` if you wire a real service.

Leave them empty for pure offline use.

## Testing

```bash
node test-parse-layer.js && node test-flow-matrix.js && node test-dify-export.js \
  && node test-export-source.js && node test-progress-restore.js \
  && node test-case-acceptance.js && node test-case-b.js
```

Tests are **pure Node** (no npm install). Acceptance scripts read/write `CASE_ACCEPTANCE_RESULT.json` **next to the script**. Restore rules live in `policy-review-progress.js` (shared by UI + tests) — covers an **old draft saved as `ready_for_export` / `allow_export:true` refreshed without results**: export stays disabled until you re-run the review.

## Scope & safety

- **Does:** local clause **stubs**, state machine, gated **module** text/CSV/JSON exports, UI HTML-wrapped `.doc`/`.xls` downloads, offline acceptance.
- **Does not:** parse real PDF/DOCX binaries; produce native binary `.docx`/`.xlsx`; connect to OA/production Dify/n8n unless **you** configure a Webhook URL; issue final legal/compliance determinations; read secrets.
- Treat exported drafts as **drafts** until human review.

## License

[MIT](./LICENSE)
