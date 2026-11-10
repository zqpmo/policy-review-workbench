const { createDifyLayer, buildDifyInput } = require('./policy-review-dify-layer.js');
const { createExportLayer } = require('./policy-review-export-layer.js');

function assert(c, m) { if (!c) throw new Error(m); }

async function main() {
  const dify = createDifyLayer({ delayMs: 50 });
  const inputCtx = {
    case_id: 'CASE-TEST-001',
    case_title: '制度审查测试',
    allow_public_source_search: false,
    reviewed_document: {
      document_name: '被审制度.docx',
      clauses: [
        { clause_id: 'R-001', article_no: '第1条', text: '总则' },
        { clause_id: 'R-003', article_no: '第3条', text: '审批' },
        { clause_id: 'R-008', article_no: '第8条', text: '职责' },
        { clause_id: 'R-015', article_no: '第15条', text: '范围' }
      ]
    },
    reference_documents: [
      {
        file_id: 'REF-001', document_name: 'upper-regulation.pdf', source_category: '上位约束源',
        source_subcategory: 'upper', is_core_basis: true,
        clauses: [{ clause_id: 'REF-001-C-005', article_no: '第12条', text: '会签' }]
      },
      {
        file_id: 'REF-002', document_name: '配套.docx', source_category: '配套协同源',
        source_subcategory: '横向', is_core_basis: false,
        clauses: [{ clause_id: 'REF-002-C-002', article_no: '第2条', text: '权责' }]
      },
      {
        file_id: 'REF-003', document_name: '旧版.docx', source_category: '历史版本源',
        source_subcategory: '旧版', is_core_basis: true,
        clauses: [{ clause_id: 'REF-003-C-004', article_no: '第10条', text: '旧范围' }]
      }
    ],
    risk_flags: { has_low_confidence_clauses: true }
  };

  const built = buildDifyInput(inputCtx);
  assert(built.comparison_framework === '三源一型', 'framework');
  assert(built.reference_documents.length === 3, 'refs');

  const rev = await dify.startReview(inputCtx);
  assert(rev.status === 'completed', 'review completed');
  assert(rev.result.excel_main_table.length >= 2, 'main table');
  assert(rev.result.excel_version_table.length >= 1, 'version table');
  assert(rev.result.word_report && rev.result.word_report.findings.length, 'word');
  assert(rev.result.qc_result && rev.result.qc_result.qc_overall, 'qc');

  const empty = await dify.startReview(Object.assign({}, inputCtx, { force_empty: true }));
  assert(empty.status === 'failed' && empty.error_code === 'DIFY_EMPTY_OUTPUT', 'empty guard');

  const exp = createExportLayer();
  try {
    await exp.exportArtifacts({ case_id: 'CASE-TEST-001', status: 'ready_for_review', allow_export: false, review_result: rev.result });
    throw new Error('should block');
  } catch (e) {
    assert(e.code === 'EXPORT_NOT_ALLOWED', 'export gate');
  }

  const ok = await exp.exportArtifacts({
    case_id: 'CASE-TEST-001',
    case_title: '制度审查测试',
    status: 'ready_for_export',
    allow_export: true,
    review_result: rev.result,
    export_targets: ['word', 'excel', 'qc_json']
  });
  assert(ok.export_status === 'success', 'export success');
  assert(ok.exported_files.length >= 3, '3+ artifacts');
  assert(ok.case_status_unchanged === true, 'no rollback');

  // partial retry word only
  const w = await exp.exportArtifacts({
    case_id: 'CASE-TEST-001',
    case_title: '制度审查测试',
    status: 'ready_for_export',
    allow_export: true,
    review_result: rev.result,
    export_targets: ['word']
  });
  assert(w.export_status === 'success', 'word only retry');
  assert(w.exported_files.filter(f => f.artifact_type === 'word').length === 1, 'word only has one word artifact');
  assert(w.exported_files.some(f => f.artifact_type === 'metadata'), 'word only still has metadata');

  console.log(JSON.stringify({
    ok: true,
    tests: ['input_contract', 'compare', 'version_table', 'qc', 'empty_guard', 'export_gate', 'export_success', 'partial_retry'],
    export_files: ok.exported_files.map(f => f.file_name)
  }, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); });
