/**
 * Export gate wiring + inline script syntax for BOTH UI pages
 * (workbench.html Chinese, workbench.en.html English).
 * Buttons and clicks must call PolicyReviewProgress.canExport — not flag+status only.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const P = require('./policy-review-progress.js');

function assert(c, m) { if (!c) throw new Error(m); }

function extractInlineScripts(html) {
  const out = [];
  const re = /<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    if (m[1] && m[1].trim()) out.push(m[1]);
  }
  return out;
}

function checkInlineSyntax(file, html) {
  const scripts = extractInlineScripts(html);
  assert(scripts.length >= 1, file + ' has at least one inline script');
  scripts.forEach((src, i) => {
    try {
      // Compile only — do not run (DOM not available)
      new vm.Script(src, { filename: file + '#script' + i });
    } catch (e) {
      throw new Error(file + ' inline script #' + i + ' syntax error: ' + e.message);
    }
  });
}

function checkCanExportWiring(file, html) {
  assert(
    /<script src="policy-review-progress\.js"><\/script>/.test(html),
    file + ' loads policy-review-progress.js'
  );

  const ubStart = html.indexOf('function updateButtons()');
  assert(ubStart >= 0, file + ' updateButtons found');
  const brace0 = html.indexOf('{', ubStart);
  let depth = 0;
  let ubEnd = brace0;
  for (let i = brace0; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') {
      depth--;
      if (depth === 0) { ubEnd = i; break; }
    }
  }
  const ub = html.slice(ubStart, ubEnd + 1);
  assert(/PolicyReviewProgress\.canExport\(/.test(ub), file + ' updateButtons calls canExport');
  assert(
    !/var exportOk = state\.allow_export && s === 'ready_for_export'/.test(ub),
    file + ' updateButtons no longer uses only allow_export && status'
  );

  const word = html.match(/\$\('btnExportWord'\)\.onclick[\s\S]{0,400}/);
  const xls = html.match(/\$\('btnExportExcel'\)\.onclick[\s\S]{0,400}/);
  assert(word && /PolicyReviewProgress\.canExport\(/.test(word[0]), file + ' word click uses canExport');
  assert(xls && /PolicyReviewProgress\.canExport\(/.test(xls[0]), file + ' excel click uses canExport');
}

function main() {
  assert(typeof P.canExport === 'function', 'canExport exported');

  const pages = ['workbench.html', 'workbench.en.html'];
  const results = [];

  for (const name of pages) {
    const p = path.join(__dirname, name);
    assert(fs.existsSync(p), name + ' exists');
    const html = fs.readFileSync(p, 'utf8');
    checkInlineSyntax(name, html);
    checkCanExportWiring(name, html);
    results.push({ page: name, syntax: 'ok', wiring: 'ok' });
  }

  // Behavioral gates (module-level)
  const base = {
    allow_export: true,
    status: 'ready_for_export',
    compareRows: [],
    report: null,
    qc: null
  };
  assert(P.canExport(base) === false, 'click gate blocks without results');
  base.compareRows = [{ clause: '§1' }];
  base.qc = { qc_overall: 'pass', qc_issues: [] };
  assert(P.canExport(base) === true, 'click gate allows with full results');

  console.log(JSON.stringify({
    ok: true,
    pages: results,
    tests: [
      'en_html_syntax',
      'zh_html_syntax',
      'en_canExport_wiring',
      'zh_canExport_wiring',
      'behavior_block_without_results',
      'behavior_allow_with_results'
    ]
  }, null, 2));
}

main();
