/**
 * 阶段6｜CASE-A / CASE-C / CASE-D 正式验收记分
 * 脱机串联 PARSE + FLOW + DIFY + EXPORT
 */
const { createParseLayer } = require('./policy-review-parse-layer.js');
const { evaluateButtons } = require('./policy-review-flow-matrix.js');
const { createDifyLayer } = require('./policy-review-dify-layer.js');
const { createExportLayer } = require('./policy-review-export-layer.js');

function assert(c, m) { if (!c) throw new Error(m); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function waitParse(layer, caseId, jobId, timeout = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const st = await layer.getStatus(caseId, jobId);
    if (st.status === 'completed' || st.status === 'parse_flagged') return st;
    await sleep(60);
  }
  throw new Error('parse timeout ' + caseId);
}

function baseRefs() {
  return [
    { file_id: 'REF-001', document_name: 'upper-regulation.pdf', source_category: '上位约束源', source_subcategory: 'upper', is_core_basis: true, reference_weight: '核心依据' },
    { file_id: 'REF-002', document_name: '配套流程.docx', source_category: '配套协同源', source_subcategory: '配套流程', is_core_basis: false, reference_weight: '辅助依据' },
    { file_id: 'REF-003', document_name: '旧版制度.docx', source_category: '历史版本源', source_subcategory: '旧版', is_core_basis: true, reference_weight: '核心依据', version_label: '2024年版' }
  ];
}

async function caseA() {
  const parse = createParseLayer({ delayMs: 25 });
  const dify = createDifyLayer({ delayMs: 40 });
  const exp = createExportLayer();
  const caseId = 'CASE-A';
  const payload = {
    case_id: caseId,
    reviewed_document_file: { file_id: 'REV-001', document_name: 'reviewed-policy.docx', type: 'docx' },
    reference_documents: baseRefs()
  };
  // FLOW: before parse, compare should be off
  let btn = evaluateButtons({
    status: 'uploaded',
    reviewed: payload.reviewed_document_file,
    refs: payload.reference_documents.map(r => Object.assign({}, r, { parse_status: 'uploaded' })),
    allow_export: false, compareRows: [], report: null
  });
  assert(btn.enabled.start_parse && !btn.enabled.start_compare && !btn.enabled.export_word, 'A-flow-pre');

  const start = await parse.startParse(payload);
  const st = await waitParse(parse, caseId, start.job_id);
  assert(st.status === 'completed', 'A-parse-completed');
  assert(st.case_status_hint === 'uploaded', 'A-hint-uploaded');
  assert((st.files || []).every(f => f.parse_status === 'success' || f.parse_status === 'partial'), 'A-files-ok');

  // attach parse results onto refs for flow/dify
  const byId = {};
  st.files.forEach(f => { byId[f.file_id] = f; });
  const reviewed = Object.assign({}, payload.reviewed_document_file, byId['REV-001'] || {});
  const refs = payload.reference_documents.map(r => Object.assign({}, r, byId[r.file_id] || {}));

  btn = evaluateButtons({
    status: 'uploaded', reviewed, refs, allow_export: false, compareRows: [], report: null
  });
  assert(btn.enabled.start_compare, 'A-compare-enabled');

  // clauses
  const revClauses = (await parse.getClauses(caseId, 'REV-001')).clauses;
  const refDocs = [];
  for (const r of refs) {
    const cs = await parse.getClauses(caseId, r.file_id);
    refDocs.push(Object.assign({}, r, { clauses: cs.clauses || [] }));
  }
  assert(revClauses.length >= 3, 'A-clauses');

  const review = await dify.startReview({
    case_id: caseId,
    case_title: 'CASE-A 成功主链',
    reviewed_document: Object.assign({}, reviewed, { clauses: revClauses }),
    reference_documents: refDocs,
    risk_flags: { has_low_confidence_clauses: false }
  });
  assert(review.status === 'completed', 'A-dify');
  assert(review.result.excel_main_table.length >= 2, 'A-main');
  assert(review.result.excel_version_table.length >= 1, 'A-version');
  assert(review.result.word_report && review.result.qc_result, 'A-word-qc');

  btn = evaluateButtons({
    status: 'ready_for_review',
    reviewed, refs,
    allow_export: false,
    compareRows: review.result.excel_main_table,
    report: review.result.word_report
  });
  assert(btn.enabled.allow_export && !btn.enabled.export_word, 'A-review-no-auto-export');

  btn = evaluateButtons({
    status: 'ready_for_export',
    reviewed, refs,
    allow_export: true,
    compareRows: review.result.excel_main_table,
    report: review.result.word_report
  });
  assert(btn.enabled.export_word && btn.enabled.export_excel, 'A-export-on');

  const out = await exp.exportArtifacts({
    case_id: caseId,
    case_title: 'CASE-A成功主链',
    status: 'ready_for_export',
    allow_export: true,
    review_result: review.result,
    export_targets: ['word', 'excel', 'qc_json']
  });
  assert(out.export_status === 'success', 'A-export-success');
  assert(out.exported_files.length >= 3, 'A-artifacts');
  assert(out.case_status_unchanged === true, 'A-no-rollback');

  return {
    case_id: 'CASE-A',
    result: 'pass',
    checks: ['parse_completed', 'compare_enabled', 'dify_outputs', 'export_gate', 'export_success'],
    export_files: out.exported_files.map(f => f.file_name)
  };
}

async function caseC() {
  const parse = createParseLayer({ delayMs: 25 });
  const caseId = 'CASE-C';
  const payload = {
    case_id: caseId,
    reviewed_document_file: { file_id: 'REV-001', document_name: '被审制度.docx', type: 'docx' },
    reference_documents: [
      { file_id: 'REF-001', document_name: '核心失败-扫描件.pdf', source_category: '上位约束源', source_subcategory: 'upper', is_core_basis: true, reference_weight: '核心依据' },
      { file_id: 'REF-002', document_name: '配套.docx', source_category: '配套协同源', source_subcategory: '横向', is_core_basis: false }
    ]
  };
  const start = await parse.startParse(payload);
  const st = await waitParse(parse, caseId, start.job_id);
  assert(st.status === 'parse_flagged', 'C-flagged');
  assert((st.blocking_issues || []).length >= 1, 'C-blocking');
  assert(st.files.some(f => f.file_id === 'REF-001' && f.parse_status === 'failed'), 'C-core-fail');

  const byId = {};
  st.files.forEach(f => { byId[f.file_id] = f; });
  const reviewed = Object.assign({}, payload.reviewed_document_file, byId['REV-001'] || {});
  const refs = payload.reference_documents.map(r => Object.assign({}, r, byId[r.file_id] || {}));

  const btn = evaluateButtons({
    status: 'parse_flagged',
    reviewed, refs,
    allow_export: false,
    compareRows: [],
    report: null
  });
  assert(!btn.enabled.start_compare, 'C-no-compare');
  assert(!btn.enabled.export_word, 'C-no-export');
  assert(btn.enabled.start_parse, 'C-can-reparse');

  // ensure dify is not entered in acceptance sense
  return {
    case_id: 'CASE-C',
    result: 'pass',
    checks: ['parse_flagged', 'core_fail_blocking', 'compare_blocked', 'export_blocked', 'reparse_allowed'],
    blocking: st.blocking_issues
  };
}

async function caseD() {
  // reuse success review then test export partial retry / failure isolation
  const parse = createParseLayer({ delayMs: 20 });
  const dify = createDifyLayer({ delayMs: 30 });
  const exp = createExportLayer();
  const caseId = 'CASE-D';
  const payload = {
    case_id: caseId,
    reviewed_document_file: { file_id: 'REV-001', document_name: '被审.docx' },
    reference_documents: baseRefs()
  };
  const start = await parse.startParse(payload);
  const st = await waitParse(parse, caseId, start.job_id);
  assert(st.status === 'completed', 'D-parse');

  const byId = {};
  st.files.forEach(f => { byId[f.file_id] = f; });
  const reviewed = Object.assign({}, payload.reviewed_document_file, byId['REV-001'] || {}, {
    clauses: (await parse.getClauses(caseId, 'REV-001')).clauses
  });
  const refs = [];
  for (const r of payload.reference_documents) {
    refs.push(Object.assign({}, r, byId[r.file_id] || {}, {
      clauses: (await parse.getClauses(caseId, r.file_id)).clauses
    }));
  }
  const review = await dify.startReview({
    case_id: caseId,
    case_title: 'CASE-D 导出恢复',
    reviewed_document: reviewed,
    reference_documents: refs
  });
  assert(review.status === 'completed', 'D-dify');

  // blocked without allow_export
  let blocked = false;
  try {
    await exp.exportArtifacts({
      case_id: caseId,
      status: 'ready_for_review',
      allow_export: false,
      review_result: review.result,
      export_targets: ['word']
    });
  } catch (e) {
    blocked = e.code === 'EXPORT_NOT_ALLOWED';
  }
  assert(blocked, 'D-export-blocked-before-allow');

  // success full export
  const full = await exp.exportArtifacts({
    case_id: caseId,
    case_title: 'CASE-D',
    status: 'ready_for_export',
    allow_export: true,
    review_result: review.result,
    export_targets: ['word', 'excel', 'qc_json']
  });
  assert(full.export_status === 'success', 'D-full');
  assert(full.case_status_unchanged === true, 'D-no-status-rollback');

  // local retry word only (export failure recovery without re-parse/dify)
  const retry = await exp.exportArtifacts({
    case_id: caseId,
    case_title: 'CASE-D',
    status: 'ready_for_export',
    allow_export: true,
    review_result: review.result,
    export_targets: ['word']
  });
  assert(retry.export_status === 'success' && retry.exported_files.length === 1, 'D-word-retry');

  // missing word_report should fail only export target, not imply parse rerun
  const bad = await exp.exportArtifacts({
    case_id: caseId,
    case_title: 'CASE-D',
    status: 'ready_for_export',
    allow_export: true,
    review_result: Object.assign({}, review.result, { word_report: null }),
    export_targets: ['word', 'qc_json']
  });
  assert(bad.export_status === 'partial' || bad.export_status === 'failed', 'D-partial-or-fail');
  assert(bad.case_status_unchanged === true, 'D-fail-no-rollback');
  // qc may still succeed
  const hasQc = (bad.exported_files || []).some(f => f.artifact_type === 'qc_json');
  assert(hasQc || (bad.errors || []).some(e => e.code === 'EXPORT_WORD_FAILED'), 'D-local-error');

  return {
    case_id: 'CASE-D',
    result: 'pass',
    checks: ['export_blocked_before_allow', 'full_export', 'word_only_retry', 'partial_failure_no_chain_rollback'],
    export_run: full.export_run_id
  };
}

async function main() {
  const results = [];
  results.push(await caseA());
  results.push(await caseC());
  results.push(await caseD());

  const pass = results.every(r => r.result === 'pass');
  const summary = {
    ok: pass,
    executed_at: new Date().toISOString(),
    cases: results,
    score: {
      'CASE-A': results.find(r => r.case_id === 'CASE-A').result,
      'CASE-C': results.find(r => r.case_id === 'CASE-C').result,
      'CASE-D': results.find(r => r.case_id === 'CASE-D').result,
      // CASE-B optional warning path not required for v1 freeze gate
      'CASE-B': 'skipped_optional'
    },
    acceptance: pass ? 'pass' : 'fail',
    p1_open: 0,
    notes: pass
      ? 'CASE-A/C/D 脱机正式记分通过；未接真实 n8n/Dify/OA。'
      : '存在失败项'
  };

  const fs = require('fs');
  const path = require('path');
  const OUT = path.join(__dirname, 'CASE_ACCEPTANCE_RESULT.json');
  fs.writeFileSync(OUT, JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  if (!pass) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
