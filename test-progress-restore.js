/**
 * Progress restore contract — old "exportable" drafts must not restore as exportable.
 */
const P = require('./policy-review-progress.js');

function assert(c, m) { if (!c) throw new Error(m); }

function freshState() {
  return {
    case_id: '',
    status: 'draft',
    allow_export: false,
    reviewed: null,
    refs: [],
    parseLog: [],
    compareRows: [],
    report: null,
    qc: null,
    result_source: 'unknown'
  };
}

async function main() {
  // 1) Legacy payload: allow_export true + ready_for_export, NO results (the bug case)
  const legacy = {
    case_id: 'CASE-OLD-1',
    title: '旧进度',
    status: 'ready_for_export',
    allow_export: true,
    reviewed: { file_id: 'REV-001', document_name: 'doc.docx' },
    refs: [{ file_id: 'REF-1', document_name: 'ref.pdf' }],
    as_of_date: '2026-01-01',
    review_mode: '制度审计',
    review_scope: 'x',
    saved_at: '2026-01-01T00:00:00.000Z'
  };
  const restored = P.applyRestore(legacy);
  assert(restored, 'legacy restores');
  assert(restored.allow_export === false, 'legacy must not restore allow_export');
  assert(restored.status === 'uploaded', 'legacy ready_for_export downgrades to uploaded, got ' + restored.status);
  assert(restored.compareRows.length === 0, 'no compare rows');
  assert(restored.report === null, 'no report');
  assert(restored.qc === null, 'no qc');
  assert(restored.result_source === 'unknown', 'source unknown');
  assert(restored.parseLog.some(l => /重新「开始审查」/.test(l.text)), 'warn log present');

  // 2) Simulate applying restore onto UI state → export disabled
  const ui = freshState();
  const a = P.applyRestore(legacy);
  ui.case_id = a.case_id;
  ui.reviewed = a.reviewed;
  ui.refs = a.refs;
  ui.status = a.status;
  ui.allow_export = a.allow_export;
  ui.compareRows = a.compareRows;
  ui.report = a.report;
  ui.qc = a.qc;
  ui.result_source = a.result_source;
  assert(P.canExport(ui) === false, 'export disabled after legacy restore');

  // 3) Even if someone forces allow_export true without results, canExport stays false
  ui.allow_export = true;
  ui.status = 'ready_for_export';
  assert(P.canExport(ui) === false, 'export still disabled without rows+qc');

  // 4) Full live results → canExport true
  ui.compareRows = [{ clause: '§1' }];
  ui.qc = { qc_overall: 'pass', qc_issues: [] };
  assert(P.canExport(ui) === true, 'export allowed with full results');

  // 5) New save payload never marks exportable
  const live = freshState();
  live.case_id = 'CASE-NEW';
  live.reviewed = { file_id: 'REV-001' };
  live.status = 'ready_for_export';
  live.allow_export = true;
  live.compareRows = [{ clause: '§1' }];
  live.qc = { qc_overall: 'pass' };
  live.result_source = 'local_mock';
  const payload = P.buildSavePayload(live, { title: 'T' });
  assert(payload.allow_export === false, 'save never allow_export true');
  assert(payload.results_saved === false, 'save marks results_saved false');
  assert(payload.status === 'uploaded', 'save downgrades ready_for_export');
  assert(!('compareRows' in payload) && !('qc' in payload) && !('result_source' in payload), 'save omits results fields');

  // 6) Round-trip: save → restore → cannot export
  const rt = P.applyRestore(payload);
  const ui2 = freshState();
  Object.assign(ui2, {
    case_id: rt.case_id,
    reviewed: rt.reviewed,
    refs: rt.refs,
    status: rt.status,
    allow_export: rt.allow_export,
    compareRows: rt.compareRows,
    report: rt.report,
    qc: rt.qc,
    result_source: rt.result_source
  });
  assert(P.canExport(ui2) === false, 'round-trip cannot export');

  // 7) draft without reviewed stays draft
  const d = P.applyRestore({ case_id: 'C', status: 'ready_for_export', allow_export: true });
  assert(d.status === 'draft', 'no reviewed → draft');
  assert(d.allow_export === false, 'draft never exportable');

  // 8) Language-scoped storage keys: ZH and EN never share a draft
  assert(P.storageKey('zh', 'CASE-1') !== P.storageKey('en', 'CASE-1'), 'zh/en keys differ');
  assert(P.storageKey('zh', 'CASE-1') === 'irw_oneshot_zh_CASE-1', 'zh key format');
  assert(P.storageKey('en', 'CASE-1') === 'irw_oneshot_en_CASE-1', 'en key format');
  assert(P.storageKey('xx', null) === 'irw_oneshot_zh_draft', 'unknown lang defaults to zh');

  const fakeStore = {
    data: {},
    getItem(k) { return Object.prototype.hasOwnProperty.call(this.data, k) ? this.data[k] : null; },
    setItem(k, v) { this.data[k] = String(v); },
    key(i) { return Object.keys(this.data)[i]; },
    get length() { return Object.keys(this.data).length; }
  };
  // Simulate Object.keys on localStorage-like: our listDraftKeys uses Object.keys(store)
  // so attach enumerable props:
  fakeStore['irw_oneshot_zh_CASE-ZH'] = JSON.stringify({ case_id: 'CASE-ZH', status: 'uploaded', refs: [{ source_category: '上位约束源' }] });
  fakeStore['irw_oneshot_en_CASE-EN'] = JSON.stringify({ case_id: 'CASE-EN', status: 'uploaded', refs: [{ source_category: 'Upper-rule source' }] });
  // Also make them appear via getItem path used by loadLatestDraft
  // listDraftKeys uses Object.keys(store) — plain object props work if store is the object itself
  const store = {};
  store['irw_oneshot_zh_CASE-ZH'] = JSON.stringify({ case_id: 'CASE-ZH', status: 'uploaded', refs: [{ source_category: '上位约束源' }] });
  store['irw_oneshot_en_CASE-EN'] = JSON.stringify({ case_id: 'CASE-EN', status: 'uploaded', refs: [{ source_category: 'Upper-rule source' }] });
  const storeLike = {
    getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; }
  };
  // Object.keys must see the keys — put them on storeLike itself
  storeLike['irw_oneshot_zh_CASE-ZH'] = store['irw_oneshot_zh_CASE-ZH'];
  storeLike['irw_oneshot_en_CASE-EN'] = store['irw_oneshot_en_CASE-EN'];

  const zhKeys = P.listDraftKeys(storeLike, 'zh');
  const enKeys = P.listDraftKeys(storeLike, 'en');
  assert(zhKeys.length === 1 && zhKeys[0].indexOf('irw_oneshot_zh_') === 0, 'zh list only zh keys');
  assert(enKeys.length === 1 && enKeys[0].indexOf('irw_oneshot_en_') === 0, 'en list only en keys');

  const zhDraft = P.loadLatestDraft(storeLike, 'zh');
  const enDraft = P.loadLatestDraft(storeLike, 'en');
  assert(zhDraft && zhDraft.case_id === 'CASE-ZH', 'zh loads zh draft');
  assert(enDraft && enDraft.case_id === 'CASE-EN', 'en loads en draft');
  assert(zhDraft.case_id !== enDraft.case_id, 'cross-language load does not mix drafts');
  // ZH page never sees EN draft
  assert(!zhKeys.some(k => k.indexOf('en_') >= 0), 'zh keys contain no en segment');
  assert(!enKeys.some(k => k.indexOf('zh_') >= 0), 'en keys contain no zh segment');

  // Legacy unprefixed keys are ignored (avoid cross-language restore bugs)
  storeLike['irw_oneshot_LEGACY'] = JSON.stringify({ case_id: 'LEGACY' });
  assert(P.listDraftKeys(storeLike, 'zh').every(k => k.indexOf('irw_oneshot_zh_') === 0), 'legacy keys ignored');
  assert(P.loadLatestDraft(storeLike, 'zh').case_id === 'CASE-ZH', 'zh still loads zh after legacy present');

  console.log(JSON.stringify({
    ok: true,
    tests: [
      'legacy_exportable_not_restored',
      'export_button_disabled',
      'force_flag_without_results_blocked',
      'full_results_can_export',
      'save_never_exportable',
      'round_trip_blocked',
      'draft_without_reviewed',
      'lang_scoped_keys',
      'zh_en_keys_isolated',
      'legacy_unprefixed_ignored'
    ]
  }, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); });
