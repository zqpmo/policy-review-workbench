/**
 * FLOW-01｜制度审查页面状态机 + 顶部按钮矩阵 v0.1
 * 依据：状态矩阵、按钮规则与异常文案
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PolicyReviewFlowMatrix = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const STATUSES = [
    'draft', 'uploaded', 'parsing', 'parse_flagged', 'comparing',
    'qc_running', 'ready_for_review', 'ready_for_export', 'manual_hold'
  ];

  /**
   * 按钮基础矩阵（未叠加条件前）
   * open | closed | conditional
   */
  const BUTTON_BASE = {
    save_draft: {
      draft: 'open', uploaded: 'open', parsing: 'closed', parse_flagged: 'open',
      comparing: 'closed', qc_running: 'closed', ready_for_review: 'open',
      ready_for_export: 'open', manual_hold: 'open'
    },
    start_parse: {
      draft: 'conditional', uploaded: 'conditional', parsing: 'closed', parse_flagged: 'conditional',
      comparing: 'closed', qc_running: 'closed', ready_for_review: 'closed',
      ready_for_export: 'closed', manual_hold: 'conditional'
    },
    start_compare: {
      // 规格表写“关”，实现上仅在解析成功后的 uploaded 放行（解析完成后回 uploaded）
      draft: 'closed', uploaded: 'conditional', parsing: 'closed', parse_flagged: 'closed',
      comparing: 'closed', qc_running: 'closed', ready_for_review: 'closed',
      ready_for_export: 'closed', manual_hold: 'closed'
    },
    run_qc: {
      draft: 'closed', uploaded: 'closed', parsing: 'closed', parse_flagged: 'closed',
      comparing: 'closed', qc_running: 'closed', ready_for_review: 'conditional',
      ready_for_export: 'conditional', manual_hold: 'closed'
    },
    allow_export: {
      draft: 'closed', uploaded: 'closed', parsing: 'closed', parse_flagged: 'closed',
      comparing: 'closed', qc_running: 'closed', ready_for_review: 'open',
      ready_for_export: 'open', manual_hold: 'closed'
    },
    export_word: {
      draft: 'closed', uploaded: 'closed', parsing: 'closed', parse_flagged: 'closed',
      comparing: 'closed', qc_running: 'closed', ready_for_review: 'closed',
      ready_for_export: 'open', manual_hold: 'closed'
    },
    export_excel: {
      draft: 'closed', uploaded: 'closed', parsing: 'closed', parse_flagged: 'closed',
      comparing: 'closed', qc_running: 'closed', ready_for_review: 'closed',
      ready_for_export: 'open', manual_hold: 'closed'
    },
    manual_hold_toggle: {
      draft: 'open', uploaded: 'open', parsing: 'open', parse_flagged: 'open',
      comparing: 'open', qc_running: 'open', ready_for_review: 'open',
      ready_for_export: 'open', manual_hold: 'open'
    }
  };

  function hasBlockingMeta(refs) {
    return (refs || []).some(function (r) {
      return !r.source_subcategory || !r.document_name;
    });
  }

  function hasCoreParseFail(reviewed, refs) {
    if (reviewed && reviewed.is_core_basis !== false && reviewed.parse_status === 'failed') return true;
    return (refs || []).some(function (r) {
      return r.is_core_basis && (r.parse_status === 'failed' || r.error_code === 'PARSE_CORE_BASIS_FAILED');
    });
  }

  function anyParsedSuccess(reviewed, refs) {
    var ok = function (f) {
      return f && (f.parse_status === 'success' || f.parse_status === 'partial');
    };
    if (ok(reviewed)) return true;
    return (refs || []).some(ok);
  }

  function canStartParse(ctx) {
    if (!ctx.reviewed) return false;
    var hasRef = (ctx.refs || []).length > 0 || !!ctx.allowPublic;
    if (!hasRef) return false;
    if (hasBlockingMeta(ctx.refs)) return false;
    if (['parsing', 'comparing', 'qc_running'].indexOf(ctx.status) >= 0) return false;
    return true;
  }

  function canStartCompare(ctx) {
    if (ctx.status === 'parse_flagged' || ctx.status === 'manual_hold') return false;
    if (hasCoreParseFail(ctx.reviewed, ctx.refs)) return false;
    if (!anyParsedSuccess(ctx.reviewed, ctx.refs)) return false;
    // 仅 uploaded（解析完成后）允许开始比对
    return ctx.status === 'uploaded';
  }

  function canRunQc(ctx) {
    if (!(ctx.compareRows && ctx.compareRows.length)) return false;
    if (!ctx.report) return false;
    return ctx.status === 'ready_for_review' || ctx.status === 'ready_for_export';
  }

  function canExport(ctx) {
    return ctx.status === 'ready_for_export' && ctx.allow_export === true && !hasCoreParseFail(ctx.reviewed, ctx.refs);
  }

  /**
   * @returns {{enabled: Object, reasons: Object}}
   */
  function evaluateButtons(ctx) {
    ctx = ctx || {};
    var status = ctx.status || 'draft';
    if (STATUSES.indexOf(status) < 0) status = 'draft';

    var enabled = {};
    var reasons = {};

    Object.keys(BUTTON_BASE).forEach(function (btn) {
      var base = BUTTON_BASE[btn][status];
      var on = false;
      var reason = '';

      if (base === 'open') {
        on = true;
      } else if (base === 'closed') {
        on = false;
        reason = '状态 ' + status + ' 不允许';
      } else if (base === 'conditional') {
        if (btn === 'start_parse') {
          on = canStartParse(ctx);
          if (!on) reason = !ctx.reviewed ? '缺少被审制度'
            : hasBlockingMeta(ctx.refs) ? '依据文件 metadata 未齐'
            : (!(ctx.refs || []).length && !ctx.allowPublic) ? '无依据且未开公开补源'
            : '当前不可解析';
        } else if (btn === 'start_compare') {
          on = canStartCompare(ctx);
          if (!on) reason = hasCoreParseFail(ctx.reviewed, ctx.refs) ? '核心依据失败阻断'
            : ctx.status === 'parse_flagged' ? 'parse_flagged 禁止比对'
            : !anyParsedSuccess(ctx.reviewed, ctx.refs) ? '尚无成功解析结果'
            : '仅解析完成后的 uploaded 可比对';
        } else if (btn === 'run_qc') {
          on = canRunQc(ctx);
          if (!on) reason = '需已有对比表与报告草稿';
        } else {
          on = false;
          reason = '条件未满足';
        }
      }

      // 导出额外硬条件
      if (btn === 'export_word' || btn === 'export_excel') {
        on = canExport(ctx);
        if (!on) reason = ctx.status !== 'ready_for_export' ? '未到 ready_for_export'
          : !ctx.allow_export ? 'allow_export=false'
          : '存在阻断问题';
      }

      if (btn === 'allow_export') {
        on = status === 'ready_for_review' || status === 'ready_for_export';
        if (!on) reason = '仅复核态可放行导出';
      }

      // manual_hold 时强制关掉推进类
      if (status === 'manual_hold' && ['start_parse', 'start_compare', 'run_qc', 'export_word', 'export_excel', 'allow_export'].indexOf(btn) >= 0) {
        // start_parse 在 hold 下规格为条件开，允许补资料后重解析
        if (btn === 'start_parse') {
          on = canStartParse(Object.assign({}, ctx, { status: 'uploaded' }));
          reason = on ? '' : '挂起中且解析条件未齐';
        } else if (btn !== 'manual_hold_toggle') {
          on = false;
          reason = 'manual_hold 阻断自动推进';
        }
      }

      enabled[btn] = !!on;
      reasons[btn] = reason;
    });

    return { enabled: enabled, reasons: reasons, status: status };
  }

  function stageHint(status) {
    var map = {
      draft: '草稿：先填任务信息并上传文件',
      uploaded: '已上传：补齐 metadata 后可开始解析；解析成功后可比对',
      parsing: '解析中：禁止重复提交解析 / 比对 / 导出',
      parse_flagged: '解析异常：核心依据失败，禁止比对与导出',
      comparing: '比对中：请等待结果回写',
      qc_running: 'QC 中：禁止改输入与导出',
      ready_for_review: '可人工复核：确认后允许导出',
      ready_for_export: '可导出：Word / Excel 已解锁',
      manual_hold: '人工挂起：自动推进已暂停'
    };
    return map[status] || status;
  }

  return {
    STATUSES: STATUSES,
    BUTTON_BASE: BUTTON_BASE,
    evaluateButtons: evaluateButtons,
    canStartParse: canStartParse,
    canStartCompare: canStartCompare,
    canRunQc: canRunQc,
    canExport: canExport,
    stageHint: stageHint,
    hasCoreParseFail: hasCoreParseFail
  };
});
