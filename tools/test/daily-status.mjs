#!/usr/bin/env node
// Reports the latest daily run, for the gate rule (Skyler, 2026-11-16): a phase gate needs a GREEN,
// COMPLETE daily run less than 24 h old, unless Skyler accepts the specific failure in writing.
//
//   node tools/test/daily-status.mjs [--max-age-h 24] [--json]
//
// Reads test-results/daily/<stamp>/summary.json (written by `run.mjs daily`) and
// test-results/final/<stamp>/summary.json (`run.mjs final` runs every daily step, so a complete
// green final run also satisfies the rule); the newest stamp wins across both, including
// incomplete runs, so a later partial or red run is never hidden behind an older green one.
// Exit 0: the newest daily is green, complete and younger than the limit. Exit 1 otherwise
// (stale, red, incomplete, or none). It prints why, the commit it ran on, and whether HEAD moved.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, git } from './lib.mjs';

const argv = process.argv.slice(2);
const i = argv.indexOf('--max-age-h');
const maxAgeH = i >= 0 ? Number(argv[i + 1]) : 24;
const runs = ['daily', 'final']
  .flatMap((t) => { const d = path.join(ROOT, 'test-results', t); return fs.existsSync(d) ? fs.readdirSync(d).map((s) => ({ t, s, dir: path.join(d, s) })) : []; })
  .filter((r) => fs.existsSync(path.join(r.dir, 'summary.json')))
  .sort((a, b) => (a.s < b.s ? -1 : a.s > b.s ? 1 : 0));
if (!runs.length) {
  console.log('daily-status: NO DAILY RUN on record (test-results/daily/*/summary.json). Run: node tools/test/run.mjs daily');
  process.exit(1);
}
const last = runs.at(-1);
const latest = `${last.t}/${last.s}`;
const s = JSON.parse(fs.readFileSync(path.join(last.dir, 'summary.json'), 'utf8'));
const ageH = (Date.now() - Date.parse(s.finishedAt)) / 3600000;
const head = git(['rev-parse', '--short', 'HEAD']);
const problems = [];
if (!s.green) problems.push(`red: ${s.failed.join(', ')}`);
if (!s.complete) problems.push(`incomplete (${s.only ? `--only ${s.only.join(',')}` : ''}${s.skip?.length ? ` --skip ${s.skip.join(',')}` : ''})`);
if (!(ageH < maxAgeH)) problems.push(`stale: ${ageH.toFixed(1)} h old (limit ${maxAgeH} h)`);
const ok = problems.length === 0;
if (argv.includes('--json')) console.log(JSON.stringify({ ok, run: latest, ageH: Number(ageH.toFixed(2)), problems, commit: s.commit, head, uncommittedPaths: s.uncommittedPaths, failed: s.failed, reportOnlyNotes: s.reportOnlyNotes, pending: s.pending }, null, 2));
else {
  console.log(`daily-status: ${ok ? 'OK' : 'NOT OK'} | latest ${latest} | finished ${s.finishedAt} (${ageH.toFixed(1)} h ago) | wall ${(s.wallMs / 60000).toFixed(1)} min`);
  console.log(`  ran on commit ${s.commit}${s.uncommittedPaths ? ` + ${s.uncommittedPaths} uncommitted paths` : ''}; HEAD is ${head}${head && head !== s.commit ? ' (HEAD moved since: say so at the gate)' : ''}`);
  for (const p of problems) console.log(`  problem: ${p}`);
  if (s.reportOnlyNotes?.length) console.log(`  report-only notes (never fail the run): ${s.reportOnlyNotes.join(', ')}`);
  for (const p of s.pending ?? []) console.log(`  pending: ${p}`);
  if (!ok) console.log('  A gate may still pass if Skyler accepts the specific failure in writing.');
}
process.exitCode = ok ? 0 : 1;
