/**
 * DIFY-01｜制度审查比对/报告/QC 契约层桩 v0.1
 * 可脱机；后续可替换为真实 Dify HTTP 调用，保持同一 API 面。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PolicyReviewDifyLayer = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function nowIso() { return new Date().toISOString(); }

  function buildDifyInput(ctx) {
    ctx = ctx || {};
    var reviewed = ctx.reviewed_document || {};
    var refs = ctx.reference_documents || [];
    return {
      case_id: ctx.case_id || 'CASE-TEST-001',
      contract_version: 'dify_io_v0.1',
      reviewed_document: {
        document_name: reviewed.document_name || '被审制度',
        document_title: reviewed.document_title || reviewed.document_name || '',
        document_code: reviewed.document_code || '',
        version_label: reviewed.version_label || '',
        effective_date: reviewed.effective_date || '',
        clauses: reviewed.clauses || []
      },
      reference_documents: refs.map(function (r) {
        return {
          file_id: r.file_id,
          document_name: r.document_name,
          document_title: r.document_title || '',
          document_code: r.document_code || '',
          source_category: r.source_category,
          source_subcategory: r.source_subcategory,
          source_origin: r.source_origin || 'user_upload',
          is_public_reference: !!r.is_public_reference,
          version_label: r.version_label || '',
          effective_date: r.effective_date || '',
          is_core_basis: !!r.is_core_basis,
          reference_weight: r.reference_weight || '辅助依据',
          overall_confidence: r.overall_confidence == null ? null : r.overall_confidence,
          clauses: r.clauses || []
        };
      }),
      comparison_framework: '三源一型',
      task_options: {
        require_history_comparison: true,
        allow_public_source_search: !!ctx.allow_public_source_search,
        require_export_ready_word: true,
        require_export_ready_excel: true,
        require_qc: true
      },
      risk_flags: {
        has_low_confidence_clauses: !!(ctx.risk_flags && ctx.risk_flags.has_low_confidence_clauses),
        has_public_supplement_sources: !!ctx.allow_public_source_search,
        missing_history_source: !refs.some(function (r) { return r.source_category === '历史版本源'; }),
        core_basis_failed_before: false
      },
      output_requirements: {
        word_template_family: 'standard-policy-review',
        excel_framework: '三源一型',
        language: 'zh-CN',
        tone: '审慎、正式、公文风',
        must_include_clause_locators: true
      }
    };
  }

  function pickClause(doc, idx) {
    var cs = (doc && doc.clauses) || [];
    if (!cs.length) {
      return {
        id: (doc && doc.file_id ? doc.file_id : 'R') + '-C-00' + (idx + 1),
        article_no: '第' + (idx + 1) + '条',
        text: '（无条文缓存，使用占位条文）'
      };
    }
    var c = cs[Math.min(idx, cs.length - 1)];
    return {
      id: c.clause_id || c.reviewed_clause_id || c.reference_clause_id || ('C-' + idx),
      article_no: c.article_no || ('第' + (idx + 1) + '条'),
      text: c.text || ''
    };
  }

  function runCompare(input) {
    var reviewed = input.reviewed_document || {};
    var refs = input.reference_documents || [];
    var upper = refs.filter(function (r) { return r.source_category === '上位约束源'; })[0];
    var collab = refs.filter(function (r) { return r.source_category === '配套协同源'; })[0];
    var hist = refs.filter(function (r) { return r.source_category === '历史版本源'; })[0];

    var r0 = pickClause(Object.assign({ file_id: 'REV' }, reviewed), 2);
    var r1 = pickClause(Object.assign({ file_id: 'REV' }, reviewed), 7);
    var r2 = pickClause(Object.assign({ file_id: 'REV' }, reviewed), 14);

    var u = upper ? pickClause(upper, 4) : { id: 'NA', article_no: '—', text: '' };
    var c = collab ? pickClause(collab, 1) : { id: 'NA', article_no: '—', text: '' };
    var h = hist ? pickClause(hist, 3) : { id: 'NA', article_no: '—', text: '' };

    var excel_main_table = [
      {
        reviewed_clause_id: r0.id,
        reviewed_article_no: r0.article_no,
        reference_file_id: upper ? upper.file_id : null,
        reference_clause_id: u.id,
        reference_article_no: u.article_no,
        source_category: '上位约束源',
        source_subcategory: upper ? upper.source_subcategory : '',
        comparison_relation: '承接',
        difference_type: '缺失承接',
        difference_summary: '待审制度对审批前置要求承接不充分',
        review_advice: '建议补充审批前置条件及责任主体',
        confidence_note: input.risk_flags && input.risk_flags.has_low_confidence_clauses ? '中（含低置信度条文）' : '高',
        // UI bridge fields
        clause: r0.article_no + ' 审批权限',
        cat: '上位约束源',
        basis: (upper ? upper.document_name : '上位依据') + ' ' + u.article_no,
        diff: '缺失承接',
        risk: '控制点未充分转化',
        qc: 'pending'
      },
      {
        reviewed_clause_id: r1.id,
        reviewed_article_no: r1.article_no,
        reference_file_id: collab ? collab.file_id : null,
        reference_clause_id: c.id,
        reference_article_no: c.article_no,
        source_category: '配套协同源',
        source_subcategory: collab ? collab.source_subcategory : '',
        comparison_relation: '协同',
        difference_type: '流程缺口',
        difference_summary: '职责与配套流程衔接不完整',
        review_advice: '建议补充职责交叉矩阵与表单证据要求',
        confidence_note: '高',
        clause: r1.article_no + ' 职责分工',
        cat: '配套协同源',
        basis: (collab ? collab.document_name : '配套依据') + ' ' + c.article_no,
        diff: '流程缺口',
        risk: '职责边界不清',
        qc: 'pending'
      }
    ];

    var excel_version_table = [];
    if (hist) {
      excel_version_table.push({
        reviewed_clause_id: r2.id,
        reviewed_article_no: r2.article_no,
        reference_file_id: hist.file_id,
        reference_clause_id: h.id,
        reference_article_no: h.article_no,
        source_category: '历史版本源',
        difference_type: '与旧版变化',
        difference_summary: '适用范围/审批层级相对旧版有所变化',
        risk_note: '可能增加执行门槛，需要同步流程文件',
        clause: r2.article_no + ' 适用范围',
        cat: '历史版本源',
        basis: hist.document_name + ' ' + h.article_no,
        diff: '与旧版变化',
        risk: '覆盖面变化待确认',
        qc: 'pending'
      });
      // also surface in main UI table as version diff row
      excel_main_table.push(Object.assign({}, excel_version_table[0], {
        comparison_relation: '版本变化',
        review_advice: '建议单列与上版本差异说明',
        confidence_note: '高'
      }));
    } else if (input.risk_flags && input.risk_flags.missing_history_source) {
      // keep empty version table intentionally
    }

    var word_report = {
      report_title: '制度合规性审查报告',
      report_summary: '总体框架基本完整，但在审批权限与职责衔接方面存在未充分承接之处，需进一步确认。',
      overview: '对《' + (reviewed.document_title || reviewed.document_name || '被审制度') + '》开展制度审计（DIFY-01 契约层草稿）。',
      opinion: '总体框架基本完整，但在审批权限与职责衔接方面存在未充分承接之处，需进一步确认。',
      major_findings: [
        {
          finding_type: '缺失承接',
          finding_summary: '审批前置要求承接不足',
          evidence_reference: '对照上位依据 ' + u.article_no + ' 与待审 ' + r0.article_no
        },
        {
          finding_type: '流程缺口',
          finding_summary: '配套权责衔接不完整',
          evidence_reference: '对照配套依据 ' + c.article_no + ' 与待审 ' + r1.article_no
        }
      ],
      findings: [
        'F-01 审批权限表述与上级要求存在差异',
        'F-02 配套权责衔接不完整',
        hist ? 'F-03 相对旧版适用范围/层级有所变化' : 'F-03 因缺少历史版本源，未形成完整版本变化判断'
      ],
      revision_suggestions: [
        '补充审批前置条件',
        '明确责任主体',
        '建议单列与上版本差异说明'
      ],
      suggestions: [
        '建议对齐上级审批会签要求',
        '建议补充职责交叉矩阵',
        '建议单列与上版本差异说明'
      ],
      limitations: [
        input.task_options && input.task_options.allow_public_source_search
          ? '部分公开补源仅作为辅助判断'
          : '本次未启用公开补源',
        input.risk_flags && input.risk_flags.has_low_confidence_clauses
          ? '个别条文定位置信度偏低，以下判断为审慎提示'
          : '条文定位总体可用'
      ]
    };

    var qc_items = [
      {
        issue_code: 'QC_REPORT_TABLE_ALIGN',
        issue_no: 'QC-01',
        issue_type: '报告与表格一致性',
        severity: 'info',
        issue_detail: '主表发现与报告 F-01~F-0' + (hist ? '3' : '2') + ' 已对齐（契约层）',
        message: '主表发现与报告编号已对齐',
        suggested_fix: '保持编号一致'
      }
    ];
    var qc_overall = 'pass';
    if (input.risk_flags && input.risk_flags.has_low_confidence_clauses) {
      qc_overall = 'flag';
      qc_items.push({
        issue_code: 'QC_OVERCLAIM_RISK',
        issue_no: 'QC-02',
        issue_type: '结论过度',
        severity: 'warning',
        issue_detail: '存在低置信度条文，已要求弱化为审慎提示',
        message: '低置信度条文不得写成确定性强结论',
        suggested_fix: '维持“未充分承接/待确认”表述'
      });
    }
    if (input.risk_flags && input.risk_flags.missing_history_source) {
      qc_items.push({
        issue_code: 'QC_MISSING_HISTORY',
        issue_no: 'QC-03',
        issue_type: '漏项',
        severity: 'warning',
        issue_detail: '缺少历史版本源，未形成完整版本变化判断',
        message: '历史版本源缺失',
        suggested_fix: '如任务需要版本比较，请补传旧版/上一版'
      });
      if (qc_overall === 'pass') qc_overall = 'flag';
    }

    excel_main_table = excel_main_table.map(function (row) {
      return Object.assign({}, row, { qc: 'pass' });
    });

    return {
      case_id: input.case_id,
      excel_main_table: excel_main_table,
      excel_version_table: excel_version_table,
      word_report: word_report,
      qc_result: {
        qc_overall: qc_overall,
        qc_issues_count: qc_items.length,
        qc_issues: qc_items,
        qc_items: qc_items
      },
      warning_issues: qc_items.filter(function (i) { return i.severity === 'warning'; }).map(function (i) {
        return { field: 'qc', message: i.message || i.issue_detail, code: i.issue_code };
      }),
      blocking_issues: [],
      finished_at: nowIso()
    };
  }

  function createDifyLayer(options) {
    var opts = options || {};
    var delayMs = opts.delayMs == null ? 400 : opts.delayMs;
    var jobs = new Map();
    var seq = 1;

    return {
      buildInput: buildDifyInput,
      startReview: function (ctx) {
        var input = buildDifyInput(ctx);
        // empty output failure injection
        if (ctx && ctx.force_empty) {
          return Promise.resolve({
            job_id: 'DIFY-EMPTY',
            status: 'failed',
            error_code: 'DIFY_EMPTY_OUTPUT',
            result: {
              case_id: input.case_id,
              excel_main_table: [],
              excel_version_table: [],
              word_report: null,
              qc_result: null,
              blocking_issues: [{ code: 'DIFY_EMPTY_OUTPUT', message: 'Dify 返回空结果' }],
              warning_issues: []
            }
          });
        }
        var jobId = 'DIFY-' + String(seq++).padStart(3, '0');
        var job = { job_id: jobId, status: 'comparing', input: input, created_at: nowIso() };
        jobs.set(jobId, job);
        return new Promise(function (resolve) {
          setTimeout(function () {
            job.status = 'qc_running';
            setTimeout(function () {
              var result = runCompare(input);
              // validate non-empty core objects
              if (!result.excel_main_table.length || !result.word_report || !result.qc_result) {
                job.status = 'failed';
                job.result = result;
                resolve({ job_id: jobId, status: 'failed', error_code: 'DIFY_EMPTY_OUTPUT', result: result });
                return;
              }
              job.status = 'completed';
              job.result = result;
              resolve({ job_id: jobId, status: 'completed', result: result });
            }, Math.max(120, delayMs / 2));
          }, delayMs);
        });
      },
      getJob: function (jobId) { return jobs.get(jobId) || null; },
      _runCompareSync: runCompare,
      _buildInput: buildDifyInput
    };
  }

  return {
    createDifyLayer: createDifyLayer,
    buildDifyInput: buildDifyInput,
    runCompare: runCompare
  };
});
