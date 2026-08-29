#!/usr/bin/env node
/*
 * Builds the landing page for the published reports from a newman run.
 *
 * Whoever opens this link wants to know what state the API is in and which
 * defects are still reproducing, without wading through a 1MB newman report
 * to find out. Hence the summary up front and the full report behind a link.
 */
const fs = require('fs');
const path = require('path');

const results = JSON.parse(fs.readFileSync(process.argv[2] || 'test-reports/results.json', 'utf8'));
const collection = JSON.parse(fs.readFileSync(process.argv[3] || 'postman/ecommerce-api-tests.postman_collection.json', 'utf8'));
const outDir = process.argv[4] || 'site';
const runNumber = process.env.GITHUB_RUN_NUMBER || 'local';

const SEVERITY = {
  1: ['Critical', 'Login issues a token for any password'],
  2: ['Critical', "Any authenticated user can read anyone's orders"],
  3: ['Critical', 'Order total ignores quantity'],
  4: ['High', 'Stock checked per line, so duplicate lines oversell'],
  5: ['Medium', 'isDetailed: true with no description'],
  6: ['Medium', 'String qty bypasses validation'],
  7: ['Medium', 'Stock never decrements'],
  8: ['Medium', 'Malformed JSON returns an HTML error page'],
  9: ['Low', 'Emails are case-sensitive'],
};
const ORDER = { Critical: 0, High: 1, Medium: 2, Low: 3 };

// request name -> issue number and folder, read out of the collection itself.
// The JSON report doesn't carry the folder each request sat in, so it has to be
// recovered here rather than from the run.
const issueOf = {};
const folderOf = {};
(function walk(items, folder) {
  items.forEach((i) => {
    if (i.item) return walk(i.item, i.name);
    folderOf[i.name] = folder || 'Other';
    const src = (i.event || [])
      .filter((e) => e.listen === 'test')
      .map((e) => e.script.exec.join(' '))
      .join(' ');
    const m = /BUGS\.md #(\d)/.exec(src);
    if (m) issueOf[i.name] = Number(m[1]);
  });
})(collection.item, null);

const stats = results.run.stats;
// stats.requests.total counts every HTTP call, which is more than the number of
// requests in the collection: a few pre-request scripts look up live product data
// first, and the isDetailed sweep sends one request per product. Report the
// collection count as "requests" and the raw call count separately, so this page
// agrees with the README instead of quietly contradicting it.
let definedRequests = 0;
(function count(items) {
  items.forEach((i) => (i.item ? count(i.item) : definedRequests++));
})(collection.item);
const failures = results.run.failures || [];
const passed = stats.assertions.total - stats.assertions.failed;
const durationMs = results.run.timings.completed - results.run.timings.started;

// which issues actually reproduced this run
const seen = new Map();
failures.forEach((f) => {
  const name = (f.source && f.source.name) || '';
  const n = issueOf[name];
  if (!n) return;
  if (!seen.has(n)) seen.set(n, new Set());
  seen.get(n).add(f.error.test || f.error.message);
});
const reproduced = [...seen.keys()]
  .sort((a, b) => ORDER[SEVERITY[a][0]] - ORDER[SEVERITY[b][0]] || a - b);

const unexpected = failures.filter((f) => !((f.source && f.source.name) || '').startsWith('[BUG-'));

// Per-folder tallies. Counted over executions, so a request that runs more than
// once (the isDetailed sweep sends one request per product) is counted each time.
const folders = {};
(results.run.executions || []).forEach((e) => {
  const name = folderOf[(e.item && e.item.name) || ''] || 'Other';
  folders[name] = folders[name] || { total: 0, failed: 0, requests: 0 };
  folders[name].requests += 1;
  (e.assertions || []).forEach(() => { folders[name].total += 1; });
});

// Failures come from the run's own failure list rather than by re-counting
// assertions, so these tally exactly with the headline figure.
failures.forEach((f) => {
  const name = folderOf[(f.source && f.source.name) || ''] || 'Other';
  if (folders[name]) folders[name].failed += 1;
});

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const repo = process.env.GITHUB_REPOSITORY || 'arslanyasin330/backend-qa-task';
const sha = (process.env.GITHUB_SHA || '').slice(0, 7);
const ref = (process.env.GITHUB_REF_NAME || 'main');
const when = new Date(results.run.timings.started).toUTCString().replace('GMT', 'UTC');

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>E-Commerce API — QA report</title>
<style>
  :root {
    color-scheme: light dark;
    --bg: #ffffff; --fg: #18181b; --muted: #71717a; --line: #e4e4e7;
    --card: #fafafa; --crit: #b91c1c; --high: #c2410c; --med: #a16207; --low: #3f6212;
    --ok: #15803d;
  }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #0b0b0d; --fg: #ededf0; --muted: #a1a1aa; --line: #27272a;
            --card: #141417; --crit: #f87171; --high: #fb923c; --med: #fbbf24; --low: #a3e635;
            --ok: #4ade80; }
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--fg);
         font: 16px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
  .wrap { max-width: 56rem; margin: 0 auto; padding: 3.5rem 1.5rem 5rem; }
  header { border-bottom: 1px solid var(--line); padding-bottom: 1.75rem; margin-bottom: 2rem; }
  h1 { font-size: 1.65rem; margin: 0 0 .35rem; letter-spacing: -.01em; }
  .meta { color: var(--muted); font-size: .9rem; }
  .meta a { color: inherit; }
  h2 { font-size: 1.05rem; margin: 2.75rem 0 1rem; letter-spacing: .01em; }
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(8rem, 1fr)); gap: 1px;
           background: var(--line); border: 1px solid var(--line); border-radius: 10px; overflow: hidden; }
  .stat { background: var(--bg); padding: 1.1rem 1.25rem; }
  .stat .n { font-size: 1.75rem; font-weight: 600; letter-spacing: -.02em; }
  .stat .l { color: var(--muted); font-size: .75rem; text-transform: uppercase; letter-spacing: .07em; margin-top: .15rem; }
  .cta { display: inline-block; margin: 1.75rem 0 0; padding: .7rem 1.25rem; border-radius: 8px;
         background: var(--fg); color: var(--bg); text-decoration: none; font-weight: 500; font-size: .95rem; }
  .note { border-left: 3px solid var(--line); padding: .2rem 0 .2rem 1.1rem; color: var(--muted);
          margin: 1.5rem 0 0; font-size: .93rem; }
  table { width: 100%; border-collapse: collapse; font-size: .93rem; }
  th { text-align: left; font-weight: 500; color: var(--muted); font-size: .75rem;
       text-transform: uppercase; letter-spacing: .07em; padding: 0 .75rem .6rem 0; border-bottom: 1px solid var(--line); }
  td { padding: .7rem .75rem .7rem 0; border-bottom: 1px solid var(--line); vertical-align: top; }
  td:last-child, th:last-child { padding-right: 0; }
  .sev { font-weight: 600; white-space: nowrap; font-size: .82rem; letter-spacing: .02em; }
  .Critical { color: var(--crit); } .High { color: var(--high); }
  .Medium { color: var(--med); } .Low { color: var(--low); }
  .num { color: var(--muted); font-variant-numeric: tabular-nums; }
  .bar { height: 5px; border-radius: 3px; background: var(--line); overflow: hidden; min-width: 5rem; }
  .bar span { display: block; height: 100%; background: var(--ok); }
  footer { margin-top: 3.5rem; padding-top: 1.5rem; border-top: 1px solid var(--line);
           color: var(--muted); font-size: .88rem; }
  a { color: inherit; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .88em; }
</style>
</head>
<body>
<div class="wrap">

<header>
  <h1>E-Commerce API — QA report</h1>
  <div class="meta">
    Run ${esc(runNumber)} on <code>${esc(ref)}</code>${sha ? ` at <code>${esc(sha)}</code>` : ''} &middot; ${esc(when)} &middot; ${(durationMs / 1000).toFixed(1)}s
    &middot; <a href="https://github.com/${esc(repo)}">repository</a>
  </div>
</header>

<div class="stats">
  <div class="stat"><div class="n">${definedRequests}</div><div class="l">Requests</div></div>
  <div class="stat"><div class="n">${stats.requests.total}</div><div class="l">HTTP calls</div></div>
  <div class="stat"><div class="n">${stats.assertions.total}</div><div class="l">Assertions</div></div>
  <div class="stat"><div class="n">${passed}</div><div class="l">Passing</div></div>
  <div class="stat"><div class="n">${stats.assertions.failed}</div><div class="l">Failing</div></div>
  <div class="stat"><div class="n">${reproduced.length}</div><div class="l">Defects</div></div>
</div>

<a class="cta" href="reports/latest/">Open the full newman report &rarr;</a>

<p class="note">
  The failing assertions are expected. This suite asserts what the API is <em>specified</em> to do
  rather than what it currently does, so each known defect shows up as a failing test naming the
  problem, instead of being quietly recorded as correct behaviour.
  ${unexpected.length === 0
    ? 'Every failure below is a documented issue &mdash; nothing unaccounted for.'
    : `<strong>${unexpected.length} failure(s) fell outside the known set and need investigating.</strong>`}
</p>

<h2>Defects reproducing in this run</h2>
<table>
  <thead><tr><th style="width:4.5rem">Severity</th><th>Issue</th><th style="width:5rem">Checks</th></tr></thead>
  <tbody>
${reproduced.map((n) => {
  const [sev, title] = SEVERITY[n];
  return `    <tr>
      <td class="sev ${sev}">${sev}</td>
      <td>${esc(title)} <span class="num">&middot; #${n}</span></td>
      <td class="num">${seen.get(n).size}</td>
    </tr>`;
}).join('\n')}
  </tbody>
</table>
<p class="note">Full write-ups, with repro steps and impact, are in
  <a href="https://github.com/${esc(repo)}/blob/main/BUGS.md">BUGS.md</a>.</p>

<h2>Coverage by area</h2>
<table>
  <thead><tr><th>Area</th><th style="width:6rem">Requests</th><th style="width:6rem">Failing</th><th style="width:10rem">Passing</th></tr></thead>
  <tbody>
${Object.entries(folders).map(([name, f]) => {
  const pct = f.total ? Math.round(((f.total - f.failed) / f.total) * 100) : 100;
  return `    <tr>
      <td>${esc(name.replace(/^\d+ - /, ''))}</td>
      <td class="num">${f.requests}</td>
      <td class="num">${f.failed || '&mdash;'}</td>
      <td><div class="bar" title="${pct}% of checks passing"><span style="width:${pct}%"></span></div></td>
    </tr>`;
}).join('\n')}
  </tbody>
</table>

<p class="note">Counted per HTTP call, which runs a little ahead of the ${definedRequests} requests in
  the collection: a few pre-request scripts fetch live product data first, and the products area sends
  one detail request per product,
  so the rule that <code>isDetailed</code> implies a description is checked across all of them rather
  than on a hardcoded pair.</p>

<footer>
  Generated automatically by GitHub Actions on every push, pull request and daily schedule.
  Historical runs stay at <code>/reports/&lt;run number&gt;/</code>.
</footer>

</div>
</body>
</html>
`;

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'index.html'), html);
console.log(`Wrote ${path.join(outDir, 'index.html')} (${reproduced.length} defects, ${stats.assertions.failed} failing assertions)`);
