const flow = require('./policy-review-flow-matrix.js');

function assert(c, m) { if (!c) throw new Error(m); }

function ev(partial) {
  return flow.evaluateButtons(Object.assign({
    status: 'draft',
    reviewed: null,
    refs: [],
    allowPublic: false,
    allow_export: false,
    compareRows: [],
    report: null
  }, partial));
}

// draft: no export/compare
let r = ev({ status: 'draft' });
assert(!r.enabled.export_word && !r.enabled.start_compare, 'draft blocks export/compare');
assert(r.enabled.save_draft, 'draft save');

// uploaded without files: parse off
r = ev({ status: 'uploaded', reviewed: null });
assert(!r.enabled.start_parse, 'no reviewed');

// uploaded ready to parse
r = ev({
  status: 'uploaded',
  reviewed: { file_id: 'R1', document_name: 'a.docx', parse_status: 'uploaded' },
  refs: [{ file_id: 'F1', document_name: 'g.pdf', source_subcategory: 'upper', is_core_basis: true, parse_status: 'uploaded' }]
});
assert(r.enabled.start_parse, 'can parse');
assert(!r.enabled.start_compare, 'cannot compare before parse success');

// parsing: parse off, compare off
r = ev({
  status: 'parsing',
  reviewed: { file_id: 'R1', document_name: 'a.docx', parse_status: 'parsing' },
  refs: [{ file_id: 'F1', document_name: 'g.pdf', source_subcategory: 'upper', is_core_basis: true, parse_status: 'parsing' }]
});
assert(!r.enabled.start_parse && !r.enabled.start_compare && !r.enabled.export_word, 'parsing locks');

// parse_flagged: compare off
r = ev({
  status: 'parse_flagged',
  reviewed: { file_id: 'R1', parse_status: 'success' },
  refs: [{ file_id: 'F1', document_name: 'fail.pdf', source_subcategory: 'upper', is_core_basis: true, parse_status: 'failed', error_code: 'PARSE_CORE_BASIS_FAILED' }]
});
assert(!r.enabled.start_compare, 'flagged no compare');
assert(r.enabled.start_parse, 'flagged can reparse');

// uploaded after success: compare on
r = ev({
  status: 'uploaded',
  reviewed: { file_id: 'R1', parse_status: 'success' },
  refs: [{ file_id: 'F1', document_name: 'g.pdf', source_subcategory: 'upper', is_core_basis: true, parse_status: 'success' }]
});
assert(r.enabled.start_compare, 'compare after success');

// ready_for_review: allow export btn on, export files off
r = ev({
  status: 'ready_for_review',
  allow_export: false,
  compareRows: [{}],
  report: {},
  reviewed: { parse_status: 'success' },
  refs: [{ source_subcategory: 'upper', is_core_basis: true, parse_status: 'success' }]
});
assert(r.enabled.allow_export && !r.enabled.export_word, 'review no auto export');
assert(r.enabled.run_qc, 'qc rerun');

// ready_for_export
r = ev({
  status: 'ready_for_export',
  allow_export: true,
  compareRows: [{}],
  report: {},
  reviewed: { parse_status: 'success' },
  refs: [{ source_subcategory: 'upper', is_core_basis: true, parse_status: 'success' }]
});
assert(r.enabled.export_word && r.enabled.export_excel, 'export on');

// manual_hold blocks compare/export
r = ev({
  status: 'manual_hold',
  reviewed: { parse_status: 'success' },
  refs: [{ source_subcategory: 'upper', is_core_basis: true, parse_status: 'success' }],
  allow_export: true
});
assert(!r.enabled.start_compare && !r.enabled.export_word, 'hold blocks');

console.log(JSON.stringify({
  ok: true,
  tests: ['draft', 'parse_gate', 'parsing_lock', 'flagged', 'compare_gate', 'review_export', 'export', 'hold']
}, null, 2));
