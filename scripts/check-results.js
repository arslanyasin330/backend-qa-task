#!/usr/bin/env node
/*
 * Decides whether a newman run should pass or fail the build.
 *
 * This suite is not meant to be green. The assertions describe what the API is
 * supposed to do, so the known defects show up as failures on purpose. A plain
 * `newman run` therefore exits non-zero on a perfectly healthy day, and wrapping
 * it in continue-on-error would mean the pipeline never tells us anything.
 *
 * So the gate is: every failure has to be one we already know about, i.e. it
 * belongs to a request tagged [BUG-n]. Anything failing outside that set is a
 * regression and fails the build. If a known defect stops failing, that's
 * probably a fix, and it gets reported so the suite can be updated.
 */
const fs = require('fs');
const path = require('path');

const reportPath = process.argv[2] || 'test-reports/results.json';
if (!fs.existsSync(reportPath)) {
  console.error(`No newman report at ${reportPath}. Did the run step fail outright?`);
  process.exit(1);
}
const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
const stats = report.run.stats;
const failures = report.run.failures || [];

const isKnown = (f) => {
  const name = (f.source && f.source.name) || '';
  // [BUG-n] requests are documented in BUGS.md. The malformed-JSON case also trips
  // the collection-wide Content-Type check, which is the same defect (#9).
  return name.startsWith('[BUG-');
};

const known = failures.filter(isKnown);
const unexpected = failures.filter((f) => !isKnown(f));

// Which documented issues actually showed up this run
const issues = new Set();
known.forEach((f) => {
  const m = /BUGS\.md #(\d)/.exec((f.source && f.source.name) || '');
  if (m) issues.add(m[1]);
});

console.log('');
console.log(`Requests    ${stats.requests.total}`);
console.log(`Assertions  ${stats.assertions.total}`);
console.log(`Failed      ${stats.assertions.failed}  (${known.length} known, ${unexpected.length} unexpected)`);
console.log('');

if (unexpected.length) {
  console.log('Unexpected failures — these are regressions, not known defects:');
  unexpected.forEach((f) => {
    console.log(`  ✗ ${(f.source && f.source.name) || 'unknown request'}`);
    console.log(`      ${f.error.test || ''}: ${f.error.message}`);
  });
  console.log('');
  console.log('Either the API changed behaviour, or the suite needs updating.');
  reportLink();
  process.exit(1);
}

function reportLink() {
  const html = reportPath.replace(/results\.json$/, 'report.html');
  console.log('');
  if (process.env.GITHUB_STEP_SUMMARY) {
    // On CI the browsable copy is published to Pages by the workflow.
    const repo = process.env.GITHUB_REPOSITORY || '';
    const [owner, name] = repo.split('/');
    const run = process.env.GITHUB_RUN_NUMBER;
    if (owner && name) {
      console.log(`Report:  https://${owner}.github.io/${name}/reports/${run}/`);
      console.log(`Latest:  https://${owner}.github.io/${name}/reports/latest/`);
    }
  } else if (fs.existsSync(html)) {
    console.log(`Report:  file://${path.resolve(html)}`);
    console.log('         (or run: npm run report)');
  }
}

if (known.length === 0) {
  console.log('None of the documented defects reproduced.');
  console.log('If they have genuinely been fixed, update the [BUG-n] assertions and BUGS.md.');
  reportLink();
  process.exit(0);
}

console.log(`All ${known.length} failures are documented defects. No regressions.`);
console.log('See BUGS.md for the write-ups.');
reportLink();
process.exit(0);
