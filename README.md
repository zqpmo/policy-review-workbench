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
- **Export layer** — gated Word/CSV/JSON drafts; blocked until status allows

**Safety default:** offline. Webhook/Dify fields are optional stubs (`http://127.0.0.1:...`). No OA, no production credentials.

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

### Chain gates (summary)

1. **Parse** must complete; core-basis parse failure → `parse_flagged` → compare/export **blocked**, reparse allowed.
2. **Warnings** (low confidence, missing history) do **not** hard-block — flag only.
3. **Export** requires explicit allow + status `ready_for_export`; QC JSON / CSV / report artifacts are named with case id + timestamp.
4. Offline acceptance cases: **A** success main chain, **B** warning path, **C** parse core fail, **D** export gate/retry.

## Optional backends (not required)

The UI exposes fields for a local n8n webhook and a Dify-compatible endpoint. Leave them empty for pure offline use. When you wire a backend, keep the same JSON contract as `buildDifyInput()` in `policy-review-dify-layer.js`.

## Testing

```bash
node test-parse-layer.js && node test-flow-matrix.js && node test-dify-export.js \
  && node test-case-acceptance.js && node test-case-b.js
```

Tests are **pure Node** (no npm install). `test-case-acceptance.js` and `test-case-b.js` read/write `CASE_ACCEPTANCE_RESULT.json` **next to the script**.

## Scope & safety

- **Does:** local clause parse stubs, state machine, gated exports, offline acceptance.
- **Does not:** connect to OA/production Dify/n8n unless you configure it; issue final legal/compliance determinations; read secrets.
- Treat exported drafts as **drafts** until human review.

## License

[MIT](./LICENSE)
