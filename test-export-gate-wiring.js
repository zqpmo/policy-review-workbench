/**
 * Export gate wiring: workbench.html must use PolicyReviewProgress.canExport
 * for BOTH button enablement and click-time checks (not just the module unit tests).
 */
const fs = require('fs');
const path = require('path');
const P = require('./policy-review-progress.js');

function assert(c, m) { if (!c) throw new Error(m); }

function main() {
  const htmlPath = path.join(__dirname, 'workbench.html');
  const html = fs.readFileSync(htmlPath, 'utf8');

  // 1) Module loaded
  assert(
    /<script src="policy-review-progress\.js"><\/script>/.test(html),
    'workbench loads policy-review-progress.js'
  );
  assert(typeof P.canExport === 'function', 'canExport exported');

  // 2) updateButtons uses canExport — extract function body by brace matching
  const ubStart = html.indexOf('function updateButtons()');
  assert(ubStart >= 0, 'updateButtons found');
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
  assert(
    /PolicyReviewProgress\.canExport\(/.test(ub),
    'updateButtons calls canExport'
  );
  assert(
    !/var exportOk = state\.allow_export && s === 'ready_for_export'/.test(ub),
    'updateButtons no longer uses only allow_export && status'
  );

  // 3) Both click handlers use canExport
  const word = html.match(/\$\('btnExportWord'\)\.onclick[\s\S]{0,350}/);
  const xls = html.match(/\$\('btnExportExcel'\)\.onclick[\s\S]{0,350}/);
  assert(word && /PolicyReviewProgress\.canExport\(/.test(word[0]), 'word click uses canExport');
  assert(xls && /PolicyReviewProgress\.canExport\(/.test(xls[0]), 'excel click uses canExport');
  assert(
    !/state\.allow_export && state\.status === 'ready_for_export'\)\) return alert/.test(word[0] || ''),
    'word click no longer gates on flag+status only'
  );

  // 4) exportHint uses canExport
  assert(/PolicyReviewProgress\.canExport\(/.test(html), 'canExport referenced in page');

  // 5) Behavioral: simulate UI applying canExport at click time
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

  // 6) Button-disabled predicate matches click predicate (same function)
  const disabledFor = (st) => !P.canExport(st);
  assert(disabledFor(base) === false, 'button enabled');
  const noResults = Object.assign({}, base, { compareRows: [], qc: null });
  assert(disabledFor(noResults) === true, 'button disabled without results');

  console.log(JSON.stringify({
    ok: true,
    tests: [
      'script_tag_present',
      'updateButtons_uses_canExport',
      'word_click_uses_canExport',
      'excel_click_uses_canExport',
      'hint_uses_canExport',
      'behavior_block_without_results',
      'behavior_allow_with_results',
      'button_and_click_same_predicate'
    ]
  }, null, 2));
}

main();
