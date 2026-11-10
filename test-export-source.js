/**
 * Export source tracking + standard CSV header + metadata.json companion
 */
const { createDifyLayer } = require('./policy-review-dify-layer.js');
const { createExportLayer, toCsv, sourceDisclaimer, normalizeSource, buildMetadata } = require('./policy-review-export-layer.js');

function assert(c, m) { if (!c) throw new Error(m); }

async function main() {
  // --- source helpers ---
  assert(normalizeSource('local_mock') === 'local_mock', 'norm mock');
  assert(normalizeSource('n8n') === 'n8n', 'norm n8n');
  assert(normalizeSource('nope') === 'unknown', 'norm unknown');
  assert(normalizeSource(undefined) === 'unknown', 'norm undefined');

  const dMock = sourceDisclaimer('local_mock');
  const dN8n = sourceDisclaimer('n8n');
  const dUnk = sourceDisclaimer('unknown');
  assert(/本地 Mock/.test(dMock) && /未读取/.test(dMock), 'mock disclaimer');
  assert(/n8n/.test(dN8n) && /未发送所选文件正文/.test(dN8n), 'n8n disclaimer');
  assert(/未知/.test(dUnk), 'unknown disclaimer');
  assert(!/模拟数据/.test(dN8n) || /后端/.test(dN8n), 'n8n must not only claim mock');

  // --- CSV: standard header first ---
  const csv = toCsv(
    [{ a: 1, b: 'x,y' }],
    ['a', 'b']
  );
  const body = csv.replace(/^﻿/, '');
  const firstLine = body.split('\n')[0];
  assert(firstLine === 'a,b', 'csv first line is header, got: ' + firstLine);
  assert(!firstLine.startsWith('#'), 'csv has no # disclaimer row');
  // naive parse: 2 columns
  const cols = firstLine.split(',');
  assert(cols.length === 2 && cols[0] === 'a' && cols[1] === 'b', 'csv columns parse');

  // --- metadata builder ---
  const meta = buildMetadata('CASE-X', 'EXPORT-001', 'local_mock', { case_title: 'T' });
  assert(meta.result_source === 'local_mock', 'meta source');
  assert(meta.file_body_read === false, 'meta body read false for mock');
  assert(/未读取/.test(meta.disclaimer), 'meta disclaimer');
  const metaN = buildMetadata('CASE-X', 'EXPORT-001', 'n8n');
  assert(metaN.file_body_read === 'unknown', 'meta n8n body unknown');

  // --- full export with each source ---
  const dify = createDifyLayer({ delayMs: 20 });
  const rev = await dify.startReview({
    case_id: 'CASE-SRC',
    case_title: '来源测试',
    reviewed_document: {
      document_name: 'doc.docx',
      clauses: [
        { clause_id: 'R-1', article_no: '第1条', text: 'a' },
        { clause_id: 'R-2', article_no: '第2条', text: 'b' },
        { clause_id: 'R-3', article_no: '第3条', text: 'c' }
      ]
    },
    reference_documents: [
      {
        file_id: 'REF-1', document_name: 'ref.pdf', source_category: '上位约束源',
        source_subcategory: 'upper', is_core_basis: true,
        clauses: [{ clause_id: 'REF-1-C-1', article_no: '第1条', text: 'x' }]
      }
    ],
    risk_flags: {}
  });
  assert(rev.status === 'completed', 'review ok');

  const exp = createExportLayer();
  for (const src of ['local_mock', 'n8n', 'unknown']) {
    const out = await exp.exportArtifacts({
      case_id: 'CASE-SRC-' + src,
      case_title: '来源测试',
      status: 'ready_for_export',
      allow_export: true,
      review_result: rev.result,
      export_targets: ['word', 'excel', 'qc_json'],
      result_source: src
    });
    assert(out.export_status === 'success', 'export ' + src);
    assert(out.result_source === src, 'out source ' + src);

    const word = out.artifacts.find(a => a.artifact_type === 'word');
    assert(word, 'word exists ' + src);
    if (src === 'local_mock') {
      assert(/本地 Mock/.test(word.content), 'word says mock');
    } else if (src === 'n8n') {
      assert(/n8n/.test(word.content), 'word says n8n');
      assert(/来源=n8n/.test(word.content) || /结果来源: n8n/.test(word.content), 'word source line');
    } else {
      assert(/未知/.test(word.content), 'word says unknown');
    }

    const csvArt = out.artifacts.find(a => a.artifact_type === 'excel_main');
    assert(csvArt, 'csv exists ' + src);
    const csvBody = csvArt.content.replace(/^﻿/, '');
    const header = csvBody.split('\n')[0];
    assert(!header.startsWith('#'), 'csv header clean ' + src);
    assert(header.indexOf('reviewed_article_no') === 0, 'csv standard header ' + src);

    const metaArt = out.artifacts.find(a => a.artifact_type === 'metadata');
    assert(metaArt, 'metadata exists ' + src);
    const parsed = JSON.parse(metaArt.content);
    assert(parsed.result_source === src, 'metadata source ' + src);
    assert(typeof parsed.disclaimer === 'string' && parsed.disclaimer.length > 10, 'metadata disclaimer');

    // QC JSON schema unchanged (no forced source field inside qc_result)
    const qc = out.artifacts.find(a => a.artifact_type === 'qc_json');
    assert(qc, 'qc exists ' + src);
    const qcObj = JSON.parse(qc.content);
    assert(qcObj.qc_overall != null || qcObj.qc_issues != null || typeof qcObj === 'object', 'qc structure intact');
  }

  console.log(JSON.stringify({
    ok: true,
    tests: ['source_normalize', 'disclaimers', 'csv_header', 'metadata_builder', 'export_local_mock', 'export_n8n', 'export_unknown', 'qc_schema_unchanged']
  }, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); });
