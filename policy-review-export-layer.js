/**
 * EXPORT-01｜Word / Excel / QC JSON 导出层桩 v0.1
 * 浏览器端生成可下载文本/CSV/JSON；不重跑解析与比对。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PolicyReviewExportLayer = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function nowStamp() {
    var d = new Date();
    var p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + p(d.getHours()) + p(d.getMinutes());
  }

  function safeName(s) {
    return String(s || 'untitled').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 40);
  }

  function csvEscape(v) {
    var s = String(v == null ? '' : v);
    if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function toCsv(rows, columns) {
    // Standard CSV: first line is always the header row
    var lines = [columns.join(',')];
    (rows || []).forEach(function (r) {
      lines.push(columns.map(function (c) { return csvEscape(r[c]); }).join(','));
    });
    return '\uFEFF' + lines.join('\n');
  }

  function normalizeSource(src) {
    if (src === 'local_mock' || src === 'n8n' || src === 'unknown') return src;
    return 'unknown';
  }

  function sourceDisclaimer(src) {
    src = normalizeSource(src);
    if (src === 'local_mock') {
      return '来源=本地 Mock：未读取所上传文件正文；条文与 QC 为模拟数据，不能当作对所选制度的真实分析。';
    }
    if (src === 'n8n') {
      return '来源=n8n：结果来自后端返回；生成结果时界面未发送所选文件正文（仅元数据）。请结合后端说明人工复核。';
    }
    return '来源=未知：无法确认结果产生方式；须人工复核，不能直接采信。';
  }

  function buildMetadata(caseId, runId, src, extra) {
    src = normalizeSource(src);
    var meta = {
      case_id: caseId,
      export_run_id: runId,
      result_source: src,
      generated_at: new Date().toISOString(),
      disclaimer: sourceDisclaimer(src),
      file_body_read: src === 'local_mock' ? false : 'unknown',
      notes: 'Companion metadata for this export batch. CSV keeps a standard header row; this file carries source and legal boundary text.'
    };
    if (extra) Object.keys(extra).forEach(function (k) { meta[k] = extra[k]; });
    return meta;
  }

  function buildWordText(caseId, report, meta) {
    report = report || {};
    meta = meta || {};
    var src = normalizeSource(meta.result_source);
    var lines = [];
    lines.push(report.report_title || '制度合规性审查报告');
    lines.push('Case: ' + caseId);
    lines.push('被审制度: ' + (meta.case_title || meta.document_name || ''));
    lines.push('结果来源: ' + src);
    lines.push('模板: standard-policy-review');
    lines.push('生成时间: ' + new Date().toISOString());
    lines.push('【重要】' + sourceDisclaimer(src));
    lines.push('【边界】本报告为AI辅助审查草稿，需人工复核确认；不构成正式法律/审计结论。');
    lines.push('');
    lines.push('一、审查/审计工作概况');
    lines.push(report.overview || report.report_summary || '');
    lines.push('');
    lines.push('三、评价意见');
    lines.push(report.opinion || report.report_summary || '');
    lines.push('');
    lines.push('四、主要发现');
    (report.findings || (report.major_findings || []).map(function (f) { return f.finding_summary; }) || []).forEach(function (f, i) {
      lines.push((i + 1) + '. ' + f);
    });
    lines.push('');
    lines.push('七、修改/审计建议');
    (report.suggestions || report.revision_suggestions || []).forEach(function (s, i) {
      lines.push((i + 1) + '. ' + s);
    });
    if (report.limitations && report.limitations.length) {
      lines.push('');
      lines.push('局限性说明');
      report.limitations.forEach(function (x) { lines.push('- ' + x); });
    }
    return lines.join('\n');
  }

  function createExportLayer() {
    var runs = new Map();
    var seq = 1;

    return {
      /**
       * targets: ['word','excel','qc_json']
       * 仅导出已有结果；失败可按 target 局部重试。
       */
      exportArtifacts: function (payload) {
        payload = payload || {};
        var caseId = String(payload.case_id || 'CASE').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 40);
        var title = safeName(payload.case_title || '制度审查');
        var stamp = nowStamp();
        var targets = payload.export_targets || ['word', 'excel', 'qc_json'];
        var allow = payload.allow_export === true;
        var status = payload.status;
        var result = payload.review_result || {};

        if (!allow || status !== 'ready_for_export') {
          return Promise.reject({
            code: 'EXPORT_NOT_ALLOWED',
            message: '未到 ready_for_export 或 allow_export=false'
          });
        }

        var runId = 'EXPORT-' + String(seq++).padStart(3, '0');
        var resultSource = normalizeSource(payload.result_source);
        var artifacts = [];
        var errors = [];

        targets.forEach(function (t) {
          try {
            if (t === 'word') {
              if (!result.word_report) throw { code: 'EXPORT_WORD_FAILED', message: '缺少 word_report' };
              // Plain-text report (not binary .docx) — extension is .txt on purpose
              var wname = '制度审查报告_' + title + '_' + caseId + '_' + stamp + '.txt';
              artifacts.push({
                artifact_type: 'word',
                file_name: wname,
                mime: 'text/plain;charset=utf-8',
                content: buildWordText(caseId, result.word_report, Object.assign({}, payload, { result_source: resultSource })),
                artifact_id: runId + '-WORD'
              });
            } else if (t === 'excel') {
              if (!result.excel_main_table || !result.excel_main_table.length) {
                throw { code: 'EXPORT_EXCEL_FAILED', message: '缺少 excel_main_table' };
              }
              var mainCols = ['reviewed_article_no', 'source_category', 'reference_article_no', 'comparison_relation', 'difference_type', 'difference_summary', 'review_advice', 'confidence_note', 'qc'];
              var mainCsv = toCsv(result.excel_main_table, mainCols);
              artifacts.push({
                artifact_type: 'excel_main',
                file_name: '逐条对比主表_' + title + '_' + caseId + '_' + stamp + '.csv',
                mime: 'text/csv;charset=utf-8',
                content: mainCsv,
                artifact_id: runId + '-XLS-MAIN'
              });
              var verCols = ['reviewed_article_no', 'reference_article_no', 'difference_type', 'difference_summary', 'risk_note'];
              var verCsv = toCsv(result.excel_version_table || [], verCols);
              artifacts.push({
                artifact_type: 'excel_version',
                file_name: '版本变化表_' + title + '_' + caseId + '_' + stamp + '.csv',
                mime: 'text/csv;charset=utf-8',
                content: verCsv,
                artifact_id: runId + '-XLS-VER'
              });
            } else if (t === 'qc_json') {
              if (!result.qc_result) throw { code: 'EXPORT_QC_FAILED', message: '缺少 qc_result' };
              artifacts.push({
                artifact_type: 'qc_json',
                file_name: caseId + '_QC结果_v0.1_' + stamp + '.json',
                mime: 'application/json;charset=utf-8',
                content: JSON.stringify(result.qc_result, null, 2),
                artifact_id: runId + '-QC'
              });
            } else {
              errors.push({ code: 'EXPORT_TARGET_MISSING', message: '未知导出目标: ' + t });
            }
          } catch (e) {
            errors.push({ code: e.code || 'EXPORT_FAILED', message: e.message || String(e), target: t });
          }
        });

        if (artifacts.length) {
          artifacts.push({
            artifact_type: 'metadata',
            file_name: caseId + '_metadata_' + stamp + '.json',
            mime: 'application/json;charset=utf-8',
            content: JSON.stringify(buildMetadata(caseId, runId, resultSource, {
              case_title: title,
              export_targets: targets.slice()
            }), null, 2),
            artifact_id: runId + '-META'
          });
        }

        var out = {
          export_run_id: runId,
          case_id: caseId,
          result_source: resultSource,
          export_status: errors.length && !artifacts.length ? 'failed' : (errors.length ? 'partial' : 'success'),
          exported_files: artifacts.map(function (a) {
            return { artifact_type: a.artifact_type, file_name: a.file_name, artifact_id: a.artifact_id };
          }),
          artifacts: artifacts,
          errors: errors,
          // 导出失败不回滚主链状态
          case_status_unchanged: true
        };
        runs.set(runId, out);
        return Promise.resolve(out);
      },

      /** browser helper */
      downloadArtifact: function (artifact) {
        if (typeof document === 'undefined') return false;
        var blob = new Blob([artifact.content], { type: artifact.mime || 'text/plain;charset=utf-8' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = artifact.file_name;
        document.body.appendChild(a);
        a.click();
        setTimeout(function () {
          URL.revokeObjectURL(url);
          a.remove();
        }, 500);
        return true;
      },

      getRun: function (id) { return runs.get(id) || null; }
    };
  }

  return {
    createExportLayer: createExportLayer,
    buildWordText: buildWordText,
    toCsv: toCsv,
    sourceDisclaimer: sourceDisclaimer,
    normalizeSource: normalizeSource,
    buildMetadata: buildMetadata
  };
});
