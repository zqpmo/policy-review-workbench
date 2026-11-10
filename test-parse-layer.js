const { createParseLayer, parseOneFile, detectFileType, chooseParser, ERROR } = require('./policy-review-parse-layer.js');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function waitJob(layer, caseId, jobId, timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const st = await layer.getStatus(caseId, jobId);
    if (st.status === 'completed' || st.status === 'parse_flagged' || st.status === 'cancelled') return st;
    await sleep(80);
  }
  throw new Error('timeout waiting job');
}

async function main() {
  // unit: routing
  assert(detectFileType('a.docx') === 'docx', 'docx type');
  assert(detectFileType('a.pdf') === 'pdf_text', 'pdf text');
  assert(detectFileType('扫描件.pdf') === 'pdf_scan', 'pdf scan');
  assert(chooseParser('docx') === 'word_parser', 'word parser');
  assert(chooseParser('pdf_scan') === 'ocr_parser', 'ocr parser');

  // unit: branches
  const word = parseOneFile({ case_id: 'C1', file_id: 'F1', document_name: '制度.docx', is_core_basis: true });
  assert(word.parser_used === 'word_parser', 'word branch');
  assert(word.parse_status === 'success', 'word success');
  assert(word.clause_count >= 3, 'word clauses');

  const pdf = parseOneFile({ case_id: 'C1', file_id: 'F2', document_name: 'upper.pdf', is_core_basis: true });
  assert(pdf.parser_used === 'text_pdf_parser', 'pdf branch');
  assert(pdf.clauses[0].clause_id, 'clause id');

  const ocr = parseOneFile({ case_id: 'C1', file_id: 'F3', document_name: '扫描旧版.pdf', is_core_basis: false });
  assert(ocr.parser_used === 'ocr_parser', 'ocr branch');

  const fail = parseOneFile({ case_id: 'C1', file_id: 'F4', document_name: '核心失败.pdf', is_core_basis: true });
  assert(fail.parse_status === 'failed', 'core fail status');
  assert(fail.error_code === ERROR.PARSE_CORE_BASIS_FAILED, 'core fail code');

  // async job + poll + idempotency
  const layer = createParseLayer({ delayMs: 40 });
  const payload = {
    case_id: 'CASE-TEST-001',
    reviewed_document_file: { file_id: 'REV-001', document_name: '被审制度.docx', type: 'docx' },
    reference_documents: [
      { file_id: 'REF-001', document_name: 'upper-regulation.pdf', source_category: '上位约束源', is_core_basis: true },
      { file_id: 'REF-002', document_name: '配套低置信.docx', source_category: '配套协同源', is_core_basis: false },
      { file_id: 'REF-003', document_name: '扫描旧版.pdf', source_category: '历史版本源', is_core_basis: true }
    ]
  };
  const start1 = await layer.startParse(payload, { idempotency_key: 'IDEMP-T1' });
  const start2 = await layer.startParse(payload, { idempotency_key: 'IDEMP-T1' });
  assert(start1.job_id === start2.job_id && start2.reused === true, 'idempotency reuse');

  const done = await waitJob(layer, 'CASE-TEST-001', start1.job_id, 5000);
  assert(done.status === 'completed' || done.status === 'parse_flagged', 'job finished');
  assert(done.files.length === 4, '4 files');
  assert(done.workspace_state && done.workspace_state.files.length === 4, 'workspace state');

  const clauses = await layer.getClauses('CASE-TEST-001', 'REF-001');
  assert(clauses.clauses.length > 0, 'get clauses');

  // CASE-C style core fail
  const layer2 = createParseLayer({ delayMs: 30 });
  const failPayload = {
    case_id: 'CASE-C',
    reviewed_document_file: { file_id: 'REV-001', document_name: '被审.docx' },
    reference_documents: [
      { file_id: 'REF-001', document_name: '核心失败-扫描.pdf', source_category: '上位约束源', is_core_basis: true }
    ]
  };
  const s = await layer2.startParse(failPayload);
  const d = await waitJob(layer2, 'CASE-C', s.job_id, 5000);
  assert(d.status === 'parse_flagged', 'case-c flagged');
  assert(d.blocking_issues.length >= 1, 'blocking issues');
  assert(d.case_status_hint === 'parse_flagged', 'case hint');

  console.log(JSON.stringify({
    ok: true,
    tests: ['route', 'word', 'pdf', 'ocr', 'core_fail', 'idempotency', 'poll', 'workspace_state', 'case_c'],
    sample_job: start1.job_id,
    sample_status: done.status,
    case_c: d.status
  }, null, 2));
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
