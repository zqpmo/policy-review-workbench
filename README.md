# policy-review-workbench

> 中文：**脱机制度审查工作台**——解析 → 对照比对 → QC → 导出 的分层状态机；默认不连网，CASE-A/B/C/D 验收测试可跑。

**Offline policy-review workbench**: parse → compare → QC → export as a layered state machine. **No network required** for the main chain; optional local n8n/Dify hooks stay stubbed until you wire them.

[![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Tests](https://img.shields.io/badge/tests-5%20suites-orange)](#testing)

## Why this exists

Policy/regulation review needs a **repeatable chain**: ingest clauses, compare against upper-level / peer / prior versions, run QC gates, then export a report — without letting a draft leak as “approved”. This workbench encodes that as:

- **Parse layer** — file → structured clauses (async jobs, failure flags block the chain)
- **Flow matrix** — button/state machine: what is legal next (compare / QC / export / hold)
- **Compare & QC layer** — contract-shaped payload (Dify-compatible stub; swap for a real HTTP backend later)
- **Export layer** — gated **plain-text report + CSV + JSON** drafts (not binary `.docx`); blocked until status allows

**Safety default:** **local Mock** — no network. Webhook/Dify fields are optional (`http://127.0.0.1:...`). No OA, no production credentials.

## Quick start

```bash
# Open the UI (self-contained single HTML)
# double-click workbench.html  or:
start workbench.html          # Windows
open workbench.html           # macOS

# Run all offline tests (no network)
node test-parse-layer.js
node test-flow-matrix.js
node test-dify-export.js
node test-case-acceptance.js   # writes CASE_ACCEPTANCE_RESULT.json
node test-case-b.js            # merges CASE-B into the result file
```

Expected: each test prints `ok: true` (or equivalent success JSON); acceptance file shows `CASE-A/B/C/D = pass`, `p1_open: 0`.

## Architecture

| File | Role |
|---|---|
| `workbench.html` | Single-file UI (styles + app JS inline) |
| `policy-review-parse-layer.js` | Parse stub: detect type, async job status, core-basis failures |
| `policy-review-flow-matrix.js` | Pure state machine → enabled/disabled actions |
| `policy-review-dify-layer.js` | Build compare/QC input contract (`dify_io_v0.1`) + stub results |
| `policy-review-export-layer.js` | Export gate, artifact naming, partial-failure behavior |
| `test-*.js` | Node unit + CASE acceptance suites |
| `CASE_ACCEPTANCE_RESULT.json` | Last acceptance scorecard |

### Known limitations (honest list)

- **Architecture prototype / offline acceptance harness** — not a production compliance system.
- **Parse layer is a stub** (async job simulation + failure flags). It does **not** extract text from real PDF/DOCX.
- **“Word” export is a plain-text report** (`.txt`, `text/plain`) plus CSV/JSON — **not** a binary `.docx`.
- **Default mode is local Mock** — no HTTP. Choosing **n8n mode** and filling a Webhook URL will `fetch` your payload (document metadata / clause JSON) to **that URL you control**; leave empty to stay offline.
- **Dify layer is a contract stub** (`dify_io_v0.1`); swap in a real backend only if you wire it yourself.
- Unit + CASE tests are **offline only** (no real n8n/Dify/OA). They do not prove end-to-end backend behavior.
- Exported artifacts are **drafts** until human review; the tool does not issue final legal/audit determinations.

### Chain gates (summary)

1. **Parse** must complete; core-basis parse failure → `parse_flagged` → compare/export **blocked**, reparse allowed.
2. **Warnings** (low confidence, missing history) do **not** hard-block — flag only.
3. **Export** requires explicit allow + status `ready_for_export`; QC JSON / CSV / report artifacts are named with case id + timestamp.
4. Offline acceptance cases: **A** success main chain, **B** warning path, **C** parse core fail, **D** export gate/retry.

## Optional backends (not required)

The UI defaults to **本地 Mock** (no network). Optional fields:

- **n8n Webhook** — if you select n8n mode and set a URL, the browser will `POST` the case payload to **that URL**. Only enable when you trust the endpoint.
- **Dify-compatible contract** — keep the JSON shape of `buildDifyInput()` in `policy-review-dify-layer.js` if you wire a real service.

Leave them empty for pure offline use.

## Testing

```bash
node test-parse-layer.js && node test-flow-matrix.js && node test-dify-export.js \
  && node test-case-acceptance.js && node test-case-b.js
```

Tests are **pure Node** (no npm install). `test-case-acceptance.js` and `test-case-b.js` read/write `CASE_ACCEPTANCE_RESULT.json` **next to the script**.

## Scope & safety

- **Does:** local clause **stubs**, state machine, gated **text/CSV/JSON** exports, offline acceptance.
- **Does not:** parse real PDF/DOCX binaries; produce binary `.docx`; connect to OA/production Dify/n8n unless **you** configure a Webhook URL; issue final legal/compliance determinations; read secrets.
- Treat exported drafts as **drafts** until human review.

## License

[MIT](./LICENSE)
