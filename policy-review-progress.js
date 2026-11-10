/**
 * Progress save/restore contract (form only — never results).
 * Used by workbench.html and offline tests so restore rules stay in one place.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PolicyReviewProgress = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DOWNSTREAM_STATUSES = {
    ready_for_export: true,
    ready_for_review: true,
    qc_running: true,
    comparing: true,
    parsing: true
  };

  function downgradeStatus(status, hasReviewed) {
    if (DOWNSTREAM_STATUSES[status || '']) {
      return hasReviewed ? 'uploaded' : 'draft';
    }
    return status || 'draft';
  }

  function normalizeLang(lang) {
    return lang === 'en' ? 'en' : 'zh';
  }

  /**
   * Language-scoped localStorage key so ZH and EN pages never share a draft
   * (category labels differ per language — cross-restore would mis-match).
   * Format: irw_oneshot_{zh|en}_{case_id|draft}
   */
  function storageKey(lang, caseId) {
    return 'irw_oneshot_' + normalizeLang(lang) + '_' + (caseId || 'draft');
  }

  function keyPrefix(lang) {
    return 'irw_oneshot_' + normalizeLang(lang) + '_';
  }

  function listDraftKeys(store, lang) {
    var prefix = keyPrefix(lang);
    try {
      return Object.keys(store)
        .filter(function (k) { return k.indexOf(prefix) === 0; })
        .sort();
    } catch (e) {
      return [];
    }
  }

  function loadLatestDraft(store, lang) {
    var keys = listDraftKeys(store, lang);
    if (!keys.length) return null;
    try {
      return JSON.parse(store.getItem(keys[keys.length - 1]) || 'null');
    } catch (e) {
      return null;
    }
  }

  /**
   * Build localStorage payload. Never includes compare/report/QC/result_source.
   * Never sets allow_export true (results are not persisted).
   */
  function buildSavePayload(state, form) {
    form = form || {};
    return {
      case_id: state.case_id,
      title: form.title || '',
      status: downgradeStatus(state.status, !!state.reviewed),
      reviewed: state.reviewed || null,
      refs: state.refs || [],
      allow_export: false,
      results_saved: false,
      as_of_date: form.as_of_date || '',
      review_mode: form.review_mode || '',
      review_scope: form.review_scope || '',
      saved_at: new Date().toISOString()
    };
  }

  /**
   * Apply a raw draft (including LEGACY payloads that had allow_export:true
   * and status ready_for_export without results) onto a fresh state shell.
   * Always clears results and export permission.
   */
  function applyRestore(raw) {
    if (!raw || !raw.case_id) return null;
    var hasReviewed = !!raw.reviewed;
    var status = downgradeStatus(raw.status, hasReviewed);
    return {
      case_id: raw.case_id,
      title: raw.title || '',
      reviewed: raw.reviewed || null,
      refs: raw.refs || [],
      status: status,
      allow_export: false,
      compareRows: [],
      report: null,
      qc: null,
      result_source: 'unknown',
      parseLog: [
        {
          type: 'warn',
          text: '已恢复表单进度；比对/QC/结果来源未保存，请重新「开始审查」后再导出。'
        }
      ]
    };
  }

  /** True if export buttons may be enabled (requires live results + flag). */
  function canExport(state) {
    return !!(
      state &&
      state.allow_export === true &&
      state.status === 'ready_for_export' &&
      Array.isArray(state.compareRows) &&
      state.compareRows.length > 0 &&
      state.qc
    );
  }

  return {
    buildSavePayload: buildSavePayload,
    applyRestore: applyRestore,
    downgradeStatus: downgradeStatus,
    canExport: canExport,
    storageKey: storageKey,
    keyPrefix: keyPrefix,
    listDraftKeys: listDraftKeys,
    loadLatestDraft: loadLatestDraft
  };
});
