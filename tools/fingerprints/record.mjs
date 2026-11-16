#!/usr/bin/env node
// T2 show-fingerprint recorder (testing interlude; record yoshi-interlude-t2-fingerprints.md).
//
//   node tools/fingerprints/record.mjs --reason "why the sim moved" [--only a,b] [--tier regular|daily]
//   node tools/fingerprints/record.mjs --check [--only a,b] [--tier regular|daily]
//
// Runs each case in engine/loop/golden/show-fingerprint.ts FINGERPRINT_CASES in Node (the product
// module, bundled with the web app's esbuild) and writes
// src/web/fireworks-web/src/engine/loop/golden/fingerprints/<case>.json.
//
// Goldens are updated only by reviewed change (schema.md §8.1; Skyler 2026-11-16). So:
//   - writing needs --reason (10+ characters). Without it nothing is written and the exit is 2.
//   - only a case whose case key, input digest or fingerprint changed is written; its reason is
//     appended to the file's header.history. An unchanged golden stays byte-identical.
//   - --check writes nothing and exits 1 when any golden is missing or differs.
// Never re-record to make a failing spec pass without saying, in --reason, why the new numbers
// are right. The diff of the golden is what the reviewer reads.
//
// Also checks that its realistic generator still matches tools/bench/shows.mjs, so "realistic-60"
// means the bench's show.
// Exit codes: 0 done (or --check clean); 1 --check found differences; 2 usage error.
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { GOLDEN_DIR, WEB, comparable, goldenPath, importBundle, readFixture, readGolden } from './lib.mjs';

const argv = process.argv.slice(2);
const opt = (n) => { const i = argv.indexOf(n); return i < 0 ? null : argv[i + 1] ?? ''; };
const check = argv.includes('--check');
const reason = opt('--reason')?.trim() ?? null;
const only = opt('--only')?.split(',').filter(Boolean) ?? null;
const tier = opt('--tier');
if (!check && (!reason || reason.length < 10 || reason.startsWith('--'))) {
  console.error('record.mjs: refusing to write goldens without --reason "<why the new numbers are right>" (10+ characters).');
  console.error('Goldens change only by reviewed change (schema.md §8.1). Use --check to compare without writing.');
  process.exit(2);
}
if (tier && !['regular', 'daily'].includes(tier)) { console.error(`record.mjs: --tier regular|daily, not ${tier}`); process.exit(2); }

const fp = await importBundle();
const { realistic } = await import('../bench/shows.mjs');
for (const d of [60, 600]) {
  if (JSON.stringify(fp.realisticShow(d)) !== JSON.stringify(realistic(d))) {
    console.error(`record.mjs: realisticShow(${d}) no longer matches tools/bench/shows.mjs realistic(${d}). Bring them back together first.`);
    process.exit(2);
  }
}
const cases = fp.FINGERPRINT_CASES.filter((c) => (!only || only.includes(c.name)) && (!tier || c.tier === tier));
if (only) for (const n of only) if (!fp.FINGERPRINT_CASES.some((c) => c.name === n)) { console.error(`record.mjs: no case ${n}`); process.exit(2); }

const prettier = await import(path.join(WEB, 'node_modules', 'prettier', 'index.mjs'));
const load = () => execSync('uptime').toString().trim().replace(/.*load averages?: /, '');
console.log(`${check ? 'check' : 'record'}: ${cases.length} cases | node ${process.version} | load ${load()}`);
fs.mkdirSync(GOLDEN_DIR, { recursive: true });

let differ = 0, written = 0;
for (const c of cases) {
  const t = performance.now();
  const doc = fp.caseInput(c, readFixture);
  const now = { case: c, inputDigest: fp.inputDigest(doc), fingerprint: fp.fingerprintShow(doc, c.run) };
  const ms = Math.round(performance.now() - t);
  const old = readGolden(c.name);
  const diff = old ? fp.diffFingerprint(comparable(old), now) : ['no golden yet'];
  const tag = diff.length ? (check ? 'DIFFERS' : 'write  ') : 'same   ';
  console.log(`${tag} ${c.name.padEnd(28)} ${String(ms).padStart(6)} ms  end ${now.fingerprint.endStep}, peak ${now.fingerprint.peakN}${diff.length ? `  (${diff.length} differences${diff.length <= 4 ? `: ${diff.join('; ')}` : `, first: ${diff[0]}`})` : ''}`);
  if (!diff.length) continue;
  differ++;
  if (check) continue;
  const history = [...(old?.header?.history ?? []), { date: new Date().toISOString().slice(0, 10), reason, node: process.version, changed: old ? diff.slice(0, 12) : ['first record'] }];
  const golden = {
    header: {
      generated: 'tools/fingerprints/record.mjs from engine/loop/golden/show-fingerprint.ts. Do not edit by hand.',
      rule: 'Updated only by reviewed change (schema.md §8.1). Every re-record appends its --reason here; the diff is the review.',
      history,
    },
    ...now,
  };
  const file = goldenPath(c.name);
  const text = JSON.stringify(golden, null, 2) + '\n';
  const formatted = await prettier.format(text, { ...(await prettier.resolveConfig(file)), filepath: file });
  fs.writeFileSync(file, formatted);
  written++;
}
console.log(check ? `check: ${differ ? `${differ} of ${cases.length} differ` : 'every golden matches'}` : `record: wrote ${written}, ${cases.length - written} unchanged`);
process.exitCode = check && differ ? 1 : 0;
