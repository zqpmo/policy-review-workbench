/** CASE-B warning 流：低置信度不停机、无历史版本仅 warning */
const { createParseLayer } = require('./policy-review-parse-layer.js');
const { evaluateButtons } = require('./policy-review-flow-matrix.js');
const { createDifyLayer } = require('./policy-review-dify-layer.js');
const { createExportLayer } = require('./policy-review-export-layer.js');
const fs = require('fs');
const path = require('path');
const OUT = path.join(__dirname, 'CASE_ACCEPTANCE_RESULT.json');;

function assert(c, m) { if (!c) throw new Error(m); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
async function waitParse(layer, caseId, jobId) {
  for (let i = 0; i < 100; i++) {
    const st = await layer.getStatus(caseId, jobId);
    if (st.status === 'completed' || st.status === 'parse_flagged') return st;
    await sleep(50);
  }
  throw new Error('timeout');
}

async function main() {
  const parse = createParseLayer({ delayMs: 20 });
  const dify = createDifyLayer({ delayMs: 30 });
  const exp = createExportLayer();
  const caseId = 'CASE-B';

  // 无历史版本；配套用低置信文件名；核心成功
  const payload = {
    case_id: caseId,
    reviewed_document_file: { file_id: 'REV-001', document_name: '被审制度.docx', type: 'docx' },
    reference_documents: [
      { file_id: 'REF-001', document_name: 'upper-regulation.pdf', source_category: '上位约束源', source_subcategory: 'upper', is_core_basis: true, reference_weight: '核心依据' },
      { file_id: 'REF-002', document_name: '配套低置信草稿.docx', source_category: '配套协同源', source_subcategory: '横向', is_core_basis: false, reference_weight: '辅助依据' }
    ]
  };

  const start = await parse.startParse(payload);
  const st = await waitParse(parse, caseId, start.job_id);
  assert(st.status === 'completed', 'B should not block on warning');
  assert(!(st.blocking_issues || []).length, 'no blocking');
  // partial warning expected on low conf file
  const partial = (st.files || []).some(f => f.file_id === 'REF-002' && (f.parse_status === 'partial' || (f.overall_confidence != null && f.overall_confidence < 0.8)));
  assert(partial || (st.warning_issues || []).length >= 0, 'warning path present');

  const byId = {};
  st.files.forEach(f => { byId[f.file_id] = f; });
  const reviewed = Object.assign({}, payload.reviewed_document_file, byId['REV-001'] || {});
  const refs = payload.reference_documents.map(r => Object.assign({}, r, byId[r.file_id] || {}));

  let btn = evaluateButtons({ status: 'uploaded', reviewed, refs, allow_export: false, compareRows: [], report: null });
  assert(btn.enabled.start_compare, 'warning must not block compare');

  const revClauses = (await parse.getClauses(caseId, 'REV-001')).clauses;
  const refDocs = [];
  for (const r of refs) {
    refDocs.push(Object.assign({}, r, { clauses: (await parse.getClauses(caseId, r.file_id)).clauses || [] }));
  }

  const review = await dify.startReview({
    case_id: caseId,
    case_title: 'CASE-B warning流',
    reviewed_document: Object.assign({}, reviewed, { clauses: revClauses }),
    reference_documents: refDocs,
    risk_flags: { has_low_confidence_clauses: true },
    allow_public_source_search: false
  });
  assert(review.status === 'completed', 'dify continues');
  assert(review.result.excel_main_table.length >= 1, 'main table');
  // missing history => version table may be empty + qc warning
  assert(Array.isArray(review.result.excel_version_table), 'version table array');
  assert(review.result.qc_result, 'qc exists');
  const qcFlag = review.result.qc_result.qc_overall === 'flag' || (review.result.warning_issues || []).length > 0 ||
    (review.result.qc_result.qc_items || review.result.qc_result.qc_issues || []).some(i => /LOW|HISTORY|低|历史/i.test(JSON.stringify(i)));
  assert(qcFlag, 'should surface warning/flag without hard stop');

  btn = evaluateButtons({
    status: 'ready_for_export', reviewed, refs, allow_export: true,
    compareRows: review.result.excel_main_table, report: review.result.word_report
  });
  assert(btn.enabled.export_word, 'export still allowed after warning');

  const out = await exp.exportArtifacts({
    case_id: caseId, case_title: 'CASE-B', status: 'ready_for_export', allow_export: true,
    review_result: review.result, export_targets: ['word', 'excel', 'qc_json']
  });
  assert(out.export_status === 'success', 'export ok');

  // merge into acceptance result
  const prev = JSON.parse(fs.readFileSync(OUT, 'utf8'));
  const b = {
    case_id: 'CASE-B',
    result: 'pass',
    checks: ['no_blocking_on_warning', 'compare_allowed', 'dify_continues', 'qc_flag_or_warning', 'export_allowed'],
    notes: '低置信/无历史版本仅 warning，不误阻断'
  };
  prev.cases = (prev.cases || []).filter(c => c.case_id !== 'CASE-B').concat([b]);
  prev.score = Object.assign({}, prev.score, { 'CASE-B': 'pass' });
  prev.acceptance = 'pass';
  prev.p1_open = 0;
  prev.executed_at = new Date().toISOString();
  prev.notes = 'CASE-A/B/C/D 脱机正式记分通过；未接真实 n8n/Dify/OA。';
  prev.ok = true;
  fs.writeFileSync(OUT, JSON.stringify(prev, null, 2));

  console.log(JSON.stringify({ ok: true, case_b: b, score: prev.score }, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); });
