/**
 * PARSE-01｜制度审查解析层接口桩 v0.1
 * 可脱机运行；后续可用真实 worker 替换同一 API 面。
 * 不读取真实机密文件内容；按文件名/类型做确定性模拟解析。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.PolicyReviewParseLayer = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const ERROR = {
    PARSE_TEXT_EXTRACTION_FAILED: 'PARSE_TEXT_EXTRACTION_FAILED',
    PARSE_OCR_FAILED: 'PARSE_OCR_FAILED',
    PARSE_STRUCTURE_NOT_FOUND: 'PARSE_STRUCTURE_NOT_FOUND',
    PARSE_CLAUSE_SPLIT_FAILED: 'PARSE_CLAUSE_SPLIT_FAILED',
    PARSE_PAGE_LOCATOR_MISSING: 'PARSE_PAGE_LOCATOR_MISSING',
    PARSE_LOW_CONFIDENCE: 'PARSE_LOW_CONFIDENCE',
    PARSE_CORE_BASIS_FAILED: 'PARSE_CORE_BASIS_FAILED'
  };

  function nowIso() {
    return new Date().toISOString();
  }

  function hashInput(parts) {
    const s = parts.join('|');
    let h = 0;
    for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    return 'H' + Math.abs(h).toString(16);
  }

  function detectFileType(name) {
    const n = (name || '').toLowerCase();
    if (/\.(png|jpe?g)$/.test(n)) return 'image';
    if (/\.docx?$/.test(n)) return 'docx';
    if (/\.pdf$/.test(n)) {
      if (/scan|ocr|扫描|影像/.test(n)) return 'pdf_scan';
      return 'pdf_text';
    }
    return 'unknown';
  }

  function chooseParser(fileType) {
    if (fileType === 'docx') return 'word_parser';
    if (fileType === 'pdf_text') return 'text_pdf_parser';
    if (fileType === 'pdf_scan' || fileType === 'image') return 'ocr_parser';
    return 'fallback_paragraph_parser';
  }

  function forceFail(name, isCore) {
    return isCore && /fail|失败|坏|损坏/.test(name || '');
  }

  function buildClauses(fileId, parser, count, baseConf) {
    const chapters = ['总则', '职责分工', '审批要求', '监督检查', '附则'];
    const clauses = [];
    for (let i = 1; i <= count; i++) {
      const ch = chapters[(i - 1) % chapters.length];
      const conf = Math.max(0.55, Math.min(0.99, baseConf - (i % 7 === 0 ? 0.12 : 0) + (i % 5) * 0.005));
      const warnings = [];
      if (conf < 0.8) warnings.push(ERROR.PARSE_LOW_CONFIDENCE);
      if (parser === 'ocr_parser' && i % 4 === 0) warnings.push(ERROR.PARSE_PAGE_LOCATOR_MISSING);
      clauses.push({
        clause_id: fileId + '-C-' + String(i).padStart(3, '0'),
        chapter_title: ch,
        article_no: '第' + i + '条',
        page_no: parser === 'ocr_parser' && i % 4 === 0 ? null : 1 + Math.floor((i - 1) / 5),
        paragraph_index: ((i - 1) % 5) + 1,
        locator_confidence: Math.round(conf * 100) / 100,
        text: '【' + ch + '】模拟条文 ' + i + '：关于' + (i % 2 ? '审批权限' : '职责衔接') + '的规定（' + parser + '）。',
        warnings: warnings
      });
    }
    return clauses;
  }

  function summarize(clauses) {
    const flagged = clauses.filter(c => (c.locator_confidence || 0) < 0.8 || (c.warnings && c.warnings.length)).length;
    const avg = clauses.length
      ? clauses.reduce((s, c) => s + (c.locator_confidence || 0), 0) / clauses.length
      : 0;
    return {
      clause_count: clauses.length,
      flagged_clause_count: flagged,
      overall_confidence: Math.round(avg * 100) / 100,
      document_structure: {
        has_chapters: clauses.some(c => !!c.chapter_title),
        has_article_numbers: clauses.some(c => !!c.article_no),
        has_page_numbers: clauses.some(c => c.page_no != null)
      }
    };
  }

  function parseOneFile(input) {
    const name = input.document_name || input.file_name || 'unknown';
    const fileId = input.file_id;
    const isCore = !!input.is_core_basis;
    const fileType = input.file_type || detectFileType(name);
    const parser = chooseParser(fileType);
    const steps = ['file_detect', 'text_extract'];

    if (forceFail(name, isCore)) {
      return {
        case_id: input.case_id,
        file_id: fileId,
        document_name: name,
        file_type: fileType,
        parser_used: parser,
        parse_status: 'failed',
        overall_confidence: 0.18,
        clause_count: 0,
        flagged_clause_count: 0,
        document_structure: { has_chapters: false, has_article_numbers: false, has_page_numbers: false },
        clauses: [],
        error_code: ERROR.PARSE_CORE_BASIS_FAILED,
        error_message: '核心依据无法形成最小可用条文集',
        parse_steps: steps.concat(['aborted']),
        finished_at: nowIso()
      };
    }

    // OCR path simulation
    if (parser === 'ocr_parser') {
      steps.push('ocr', 'text_clean', 'clause_split');
      if (/无法识别|空白扫描|blank/.test(name)) {
        return {
          case_id: input.case_id,
          file_id: fileId,
          document_name: name,
          file_type: fileType,
          parser_used: parser,
          parse_status: isCore ? 'failed' : 'partial',
          overall_confidence: 0.32,
          clause_count: isCore ? 0 : 2,
          flagged_clause_count: isCore ? 0 : 2,
          document_structure: { has_chapters: false, has_article_numbers: false, has_page_numbers: false },
          clauses: isCore ? [] : buildClauses(fileId, parser, 2, 0.4),
          error_code: isCore ? ERROR.PARSE_CORE_BASIS_FAILED : ERROR.PARSE_OCR_FAILED,
          error_message: '扫描质量过低，OCR 不稳定',
          parse_steps: steps,
          finished_at: nowIso()
        };
      }
      const clauses = buildClauses(fileId, parser, isCore ? 18 : 12, isCore ? 0.82 : 0.74);
      const sum = summarize(clauses);
      const status = sum.overall_confidence >= 0.8 ? 'success' : 'partial';
      return {
        case_id: input.case_id,
        file_id: fileId,
        document_name: name,
        file_type: fileType,
        parser_used: parser,
        parse_status: status,
        ...sum,
        clauses: clauses,
        error_code: status === 'partial' ? ERROR.PARSE_LOW_CONFIDENCE : null,
        error_message: status === 'partial' ? 'OCR 结果可用但置信度偏低' : null,
        parse_steps: steps.concat(['confidence']),
        finished_at: nowIso()
      };
    }

    // Word / text PDF
    steps.push(parser === 'word_parser' ? 'docx_structure' : 'pdf_text_extract', 'clause_split', 'page_locate');
    const base = parser === 'word_parser' ? 0.94 : 0.9;
    const count = parser === 'word_parser' ? (isCore ? 36 : 24) : (isCore ? 42 : 28);
    const clauses = buildClauses(fileId, parser, count, base);
    const sum = summarize(clauses);
    // 非核心偶发 partial
    let status = 'success';
    let err = null;
    let msg = null;
    if (!isCore && /low|低置信|草稿/.test(name)) {
      status = 'partial';
      err = ERROR.PARSE_LOW_CONFIDENCE;
      msg = '非核心依据置信度偏低，允许继续但需关注';
      sum.overall_confidence = Math.min(sum.overall_confidence, 0.72);
    }
    return {
      case_id: input.case_id,
      file_id: fileId,
      document_name: name,
      file_type: fileType,
      parser_used: parser,
      parse_status: status,
      ...sum,
      clauses: clauses,
      error_code: err,
      error_message: msg,
      parse_steps: steps.concat(['confidence']),
      finished_at: nowIso()
    };
  }

  function createParseLayer(options) {
    const opts = options || {};
    const delayMs = opts.delayMs == null ? 350 : opts.delayMs;
    const jobs = new Map(); // job_id -> job
    const idempo = new Map(); // key -> job_id
    let jobSeq = 1;

    function makeJobId() {
      return 'PARSE-' + String(jobSeq++).padStart(3, '0');
    }

    function snapshotFiles(payload) {
      const files = [];
      if (payload.reviewed_document_file) {
        const r = payload.reviewed_document_file;
        files.push({
          case_id: payload.case_id,
          file_id: r.file_id || 'REV-001',
          document_name: r.document_name || r.name,
          file_type: r.file_type || r.type || detectFileType(r.document_name || r.name),
          is_core_basis: true,
          source_category: '被审制度',
          source_subcategory: '主文件',
          reference_weight: '被审'
        });
      }
      (payload.reference_documents || []).forEach(function (f) {
        files.push({
          case_id: payload.case_id,
          file_id: f.file_id,
          document_name: f.document_name,
          file_type: f.file_type || detectFileType(f.document_name),
          is_core_basis: !!f.is_core_basis,
          source_category: f.source_category,
          source_subcategory: f.source_subcategory,
          reference_weight: f.reference_weight
        });
      });
      return files;
    }

    function runJob(job) {
      job.status = 'parsing';
      job.started_at = nowIso();
      job.files.forEach(function (f) {
        f.parse_status = 'parsing';
        f.progress = 0;
      });

      const total = job.files.length || 1;
      let i = 0;

      function next() {
        if (job.cancelled) {
          job.status = 'cancelled';
          job.finished_at = nowIso();
          return;
        }
        if (i >= job.files.length) {
          finalize(job);
          return;
        }
        const f = job.files[i++];
        setTimeout(function () {
          const result = parseOneFile(f);
          Object.assign(f, result);
          f.progress = 100;
          job.results[f.file_id] = result;
          job.updated_at = nowIso();
          next();
        }, delayMs);
      }
      next();
      return { total: total };
    }

    function finalize(job) {
      const results = Object.values(job.results);
      const coreFailed = results.some(function (r) {
        return r.is_core_basis !== false && (r.error_code === ERROR.PARSE_CORE_BASIS_FAILED || (r.parse_status === 'failed' && job.files.find(function (x) { return x.file_id === r.file_id && x.is_core_basis; })));
      }) || job.files.some(function (f) {
        return f.is_core_basis && f.parse_status === 'failed';
      });

      // mark is_core on results from job.files
      job.files.forEach(function (f) {
        if (job.results[f.file_id]) job.results[f.file_id].is_core_basis = f.is_core_basis;
      });

      const anyFailedCore = job.files.some(function (f) {
        return f.is_core_basis && (f.parse_status === 'failed' || f.error_code === ERROR.PARSE_CORE_BASIS_FAILED);
      });

      job.status = anyFailedCore ? 'parse_flagged' : 'completed';
      job.case_status_hint = anyFailedCore ? 'parse_flagged' : 'uploaded';
      job.blocking_issues = [];
      job.warning_issues = [];
      job.files.forEach(function (f) {
        if (f.is_core_basis && f.parse_status === 'failed') {
          job.blocking_issues.push({
            field: 'parse_status',
            file_id: f.file_id,
            code: f.error_code || ERROR.PARSE_CORE_BASIS_FAILED,
            message: '核心依据解析失败：' + f.document_name
          });
        } else if (f.parse_status === 'partial') {
          job.warning_issues.push({
            field: 'overall_confidence',
            file_id: f.file_id,
            code: f.error_code || ERROR.PARSE_LOW_CONFIDENCE,
            message: f.document_name + ' 低置信度/部分成功'
          });
        }
      });
      job.finished_at = nowIso();
      job.updated_at = job.finished_at;
      job.workspace_state = buildWorkspaceState(job);
    }

    function buildWorkspaceState(job) {
      return {
        case_id: job.case_id,
        job_id: job.job_id,
        status: job.case_status_hint,
        parse_job_status: job.status,
        files: job.files.map(function (f) {
          return {
            file_id: f.file_id,
            document_name: f.document_name,
            source_category: f.source_category,
            is_core_basis: f.is_core_basis,
            parse_status: f.parse_status,
            overall_confidence: f.overall_confidence,
            clause_count: f.clause_count,
            flagged_clause_count: f.flagged_clause_count,
            parser_used: f.parser_used,
            error_code: f.error_code || null
          };
        }),
        blocking_issues: job.blocking_issues || [],
        warning_issues: job.warning_issues || [],
        updated_at: job.updated_at || nowIso()
      };
    }

    return {
      ERROR: ERROR,
      detectFileType: detectFileType,
      chooseParser: chooseParser,

      /** POST /api/reference-files/parse */
      startParse: function (payload, meta) {
        meta = meta || {};
        const files = snapshotFiles(payload || {});
        if (!files.length) {
          return Promise.reject({ code: 'EMPTY_FILES', message: '无待解析文件' });
        }
        const inputHash = hashInput(files.map(function (f) {
          return f.file_id + ':' + f.document_name + ':' + f.is_core_basis;
        }));
        const idem = meta.idempotency_key || ('IDEMP-PARSE-' + (payload.case_id || 'CASE') + '-' + inputHash);

        if (idempo.has(idem)) {
          const existingId = idempo.get(idem);
          const existing = jobs.get(existingId);
          return Promise.resolve({
            job_id: existing.job_id,
            status: existing.status === 'completed' || existing.status === 'parse_flagged' ? existing.status : 'parsing',
            reused: true,
            idempotency_key: idem
          });
        }

        // active job guard
        for (const j of jobs.values()) {
          if (j.case_id === payload.case_id && j.status === 'parsing') {
            return Promise.resolve({
              job_id: j.job_id,
              status: 'parsing',
              reused: true,
              idempotency_key: j.idempotency_key
            });
          }
        }

        const jobId = makeJobId();
        const job = {
          job_id: jobId,
          case_id: payload.case_id,
          idempotency_key: idem,
          input_hash: inputHash,
          status: 'queued',
          files: files,
          results: {},
          blocking_issues: [],
          warning_issues: [],
          created_at: nowIso(),
          updated_at: nowIso()
        };
        jobs.set(jobId, job);
        idempo.set(idem, jobId);
        runJob(job);
        return Promise.resolve({
          job_id: jobId,
          status: 'parsing',
          reused: false,
          idempotency_key: idem
        });
      },

      /** GET /api/reference-files/status?case_id= */
      getStatus: function (caseId, jobId) {
        let job = jobId ? jobs.get(jobId) : null;
        if (!job && caseId) {
          const list = Array.from(jobs.values()).filter(function (j) { return j.case_id === caseId; });
          job = list.sort(function (a, b) { return (a.created_at < b.created_at ? 1 : -1); })[0];
        }
        if (!job) {
          return Promise.resolve({ case_id: caseId, status: 'idle', files: [] });
        }
        return Promise.resolve({
          case_id: job.case_id,
          job_id: job.job_id,
          status: job.status,
          case_status_hint: job.case_status_hint || null,
          files: job.files.map(function (f) {
            return {
              file_id: f.file_id,
              document_name: f.document_name,
              parse_status: f.parse_status,
              overall_confidence: f.overall_confidence == null ? null : f.overall_confidence,
              clause_count: f.clause_count == null ? null : f.clause_count,
              flagged_clause_count: f.flagged_clause_count == null ? null : f.flagged_clause_count,
              parser_used: f.parser_used || null,
              error_code: f.error_code || null,
              error_message: f.error_message || null,
              progress: f.progress == null ? (f.parse_status === 'parsing' ? 40 : 100) : f.progress
            };
          }),
          blocking_issues: job.blocking_issues || [],
          warning_issues: job.warning_issues || [],
          workspace_state: job.workspace_state || buildWorkspaceState(job),
          updated_at: job.updated_at
        });
      },

      /** POST /api/reference-files/reparse */
      reparseFile: function (payload) {
        const caseId = payload.case_id;
        const fileId = payload.file_id;
        // find latest job file snapshot or accept inline file meta
        let fileMeta = payload.file || null;
        if (!fileMeta) {
          const list = Array.from(jobs.values()).filter(function (j) { return j.case_id === caseId; });
          const latest = list.sort(function (a, b) { return (a.created_at < b.created_at ? 1 : -1); })[0];
          if (latest) fileMeta = latest.files.find(function (f) { return f.file_id === fileId; });
        }
        if (!fileMeta) {
          return Promise.reject({ code: 'FILE_NOT_FOUND', message: '找不到 file_id' });
        }
        return this.startParse({
          case_id: caseId,
          reviewed_document_file: fileMeta.source_category === '被审制度' ? fileMeta : null,
          reference_documents: fileMeta.source_category === '被审制度' ? [] : [fileMeta]
        }, { idempotency_key: 'IDEMP-REPARSE-' + caseId + '-' + fileId + '-' + Date.now() });
      },

      /** GET clauses for a file from last completed job */
      getClauses: function (caseId, fileId) {
        const list = Array.from(jobs.values()).filter(function (j) { return j.case_id === caseId; });
        const latest = list.sort(function (a, b) { return (a.created_at < b.created_at ? 1 : -1); })[0];
        if (!latest || !latest.results[fileId]) {
          return Promise.resolve({ case_id: caseId, file_id: fileId, clauses: [] });
        }
        const r = latest.results[fileId];
        return Promise.resolve({
          case_id: caseId,
          file_id: fileId,
          parse_status: r.parse_status,
          clauses: r.clauses || []
        });
      },

      /** sync helper for unit tests */
      _parseOneSync: parseOneFile,
      _jobs: jobs
    };
  }

  return {
    createParseLayer: createParseLayer,
    ERROR: ERROR,
    detectFileType: detectFileType,
    chooseParser: chooseParser,
    parseOneFile: parseOneFile
  };
});
