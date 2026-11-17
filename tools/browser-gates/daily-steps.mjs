// The browser half of the daily suite (testing-strategy.md §2.3), as a list of steps that
// `tools/test/run.mjs daily` runs one by one (and `node daily.mjs` runs on its own).
//
// Each step: { name, cmd, args, env, gate, expectExit, mustSay, timeoutS, cwd }. The runner
// replaces `$BASE` and `$PORT` in args, and sets BASE, CODES and OUT_DIR in the env.
//   gate 'fail'    a failure fails the daily run
//   gate 'report'  the result is recorded, never fails the run
//   expectExit 1   a negative control whose script exits 1 when it catches the break; mustSay is
//                  then required in the output, so a crash can't pass as a caught control
//
// Classification (Skyler 2026-11-16: cross-browser mismatches are report-only; crashes and failed
// loads fail the run; standing: "cross-browser means it runs in each browser"):
//   Chromium: every gate script and every negative control fails the run.
//   Firefox and WebKit: "does it run" steps fail the run (gate-csp: every page loads with zero
//   violations and errors and the stage runs; gate-roundtrip: builder save, share, Show JSON and
//   the real-time play to the end). Behavior-fidelity walks (keyboard order, reduced motion,
//   follow paging) are report-only there.
//   Benchmarks (gate-warm, the Node seek bench) are report-only (§5.4), and run only in the final
//   tier (Skyler 2026-11-16: benchmarks, the at-maximums runs and the uncached docker build move
//   to `final`, the end-of-project review). So does the at-maximums fingerprint case in the three
//   engines (FP_CASES=at-maximums, its own FP_TAG so the daily results file is untouched).
//   T2 fingerprints (fingerprints.mjs, Yoshi's T2): in every engine the run step fails the run on
//   a crash, a failed launch or a timeout. The compare step fails the run in Chromium (same V8 as
//   the Node recorder, so a mismatch there means the harness is broken) and is report-only in
//   Firefox and WebKit (Skyler 2026-11-16: fingerprint mismatches are report-only).
import { HERE, ROOT } from './lib/common.mjs';
import path from 'node:path';

export function dailySteps({ codes, gone, tier = 'daily' }) {
  const node = process.execPath;
  const s = (name, args, { env = {}, gate = 'fail', expectExit = 0, mustSay = null, timeoutS = 600, cmd = node, cwd = HERE } = {}) => ({ name, cmd, args, env, gate, expectExit, mustSay, timeoutS, cwd });
  const steps = [];
  steps.push(
    s('headers-main', ['-I', 'headers.py', '$PORT', codes.shell, codes.shellB, 'main'], { cmd: 'python3' }),
    s('headers-put', ['-I', 'headers.py', '$PORT', codes.shell, codes.shellB, 'put'], { cmd: 'python3' }),
    s('headers-neg', ['-I', 'headers.py', '$PORT', codes.shell, codes.shellB, 'main'], { cmd: 'python3', env: { HEADERS_NEG: '1' }, expectExit: 1, mustSay: /main: \d+ ok, [1-9]\d* fail/ }),
    s('notfound', ['notfound.mjs'], { env: { GONE: gone } }),
    s('csp-chromium', ['gate-csp.mjs'], { env: { ENGINES: 'chromium' } }),
    s('csp-neg', ['gate-csp.mjs'], { env: { MODE: 'none' } }),
    s('csp-neg-selftest', ['gate-csp.mjs'], { env: { MODE: 'none', NEG_SELFTEST: '1', PATHS: '/' }, expectExit: 1, mustSay: /NOT CAUGHT/ }),
    s('keyboard-chromium', ['gate-keyboard.mjs'], { env: { ENGINES: 'chromium' } }),
    s('keyboard-neg-focus', ['gate-keyboard.mjs'], { env: { ENGINES: 'chromium', NEG: 'focus' } }),
    s('keyboard-neg-walk', ['gate-keyboard.mjs'], { env: { ENGINES: 'chromium', NEG: 'walk' } }),
    s('touch-chromium', ['gate-touch.mjs'], { env: { ENGINES: 'chromium' } }),
    s('touch-neg', ['gate-touch.mjs'], { env: { ENGINES: 'chromium', NEG: '1' } }),
    s('reduced-motion-chromium', ['gate-reduced-motion.mjs'], { env: { ENGINES: 'chromium' } }),
    s('reduced-motion-neg', ['gate-reduced-motion.mjs'], { env: { ENGINES: 'chromium', NEG: '1' } }),
    s('follow-chromium', ['gate-follow.mjs'], { env: { ENGINES: 'chromium' } }),
    s('follow-neg', ['gate-follow.mjs'], { env: { ENGINES: 'chromium', NEG: '1' } }),
    // Phase 8 B3 (Toad): CSRF from a :5190 page, the CSP-clean sign-in, the two-account walk.
    s('auth-chromium', ['gate-auth.mjs']),
    s('auth-neg-csrf', ['gate-auth.mjs'], { env: { PARTS: 'csrf', NEG: 'csrf' }, expectExit: 1, mustSay: /CSRF LANDED: signed out, list changed/ }),
    s('auth-neg-csp', ['gate-auth.mjs'], { env: { PARTS: 'csp', NEG: 'csp' }, expectExit: 1, mustSay: /CSP VIOLATION: .*\/mine script-src/ }),
    s('auth-neg-walk', ['gate-auth.mjs'], { env: { PARTS: 'walk', NEG: 'walk' }, expectExit: 1, mustSay: /OWNERSHIP NOT ENFORCED: .*PUT of alice's code is 404.*DELETE of alice's code is 404/ }),
    s('player-vt', ['player-virtual-time.mjs']),
    s('player-vt-neg-frozen', ['player-virtual-time.mjs'], { env: { PAUSE: '0', PHASES: 'frozen' }, expectExit: 1, mustSay: /MOVED/ }),
    s('player-vt-neg-ended', ['player-virtual-time.mjs'], { env: { NEG_HIDE_ENDED: '1', PHASES: 'ff', MAX_FF: '200' }, expectExit: 1, mustSay: /did not end under virtual time/ }),
    // The real-time 66 s play, Chromium, with the Show JSON round trip in a fresh profile.
    s('roundtrip-chromium', ['gate-roundtrip.mjs', 'chromium'], { env: { JSON_ENGINE: 'chromium' }, timeoutS: 900 }),
    s('roundtrip-neg-error', ['gate-roundtrip.mjs', 'chromium', codes.show], { env: { JSON_ENGINE: 'none', TOAD_INJECT_ERROR: '1' }, expectExit: 1, mustSay: /FAIL: console errors/, timeoutS: 900 }),
    s('roundtrip-neg-ended', ['gate-roundtrip.mjs', 'chromium', codes.show], { env: { JSON_ENGINE: 'none', TOAD_HIDE_ENDED: '1', TOAD_END_TIMEOUT_S: '100' }, expectExit: 1, mustSay: /timed out at/, timeoutS: 600 }),
    s('roundtrip-neg-same-cue', ['gate-roundtrip.mjs', 'chromium'], { env: { JSON_ENGINE: 'none', SKIP_PLAY: '1', TOAD_SAME_CUE: '1' }, expectExit: 1, mustSay: /6b\.2/ }),
    s('roundtrip-neg-clipboard', ['gate-roundtrip.mjs', 'chromium'], { env: { JSON_ENGINE: 'none', SKIP_PLAY: '1', TOAD_BLOCK_CLIPBOARD: '1' }, expectExit: 1, mustSay: /6f\.9 share failed/ }),
    s('roundtrip-neg-tamper', ['gate-roundtrip.mjs', 'chromium', codes.show], { env: { JSON_ENGINE: 'chromium', SKIP_PLAY: '1', TOAD_JSON_TAMPER: '1' }, expectExit: 1, mustSay: /7k\.3 Show JSON round trip differs/ }),
  );
  for (const e of ['firefox', 'webkit']) {
    steps.push(
      s(`csp-${e}`, ['gate-csp.mjs'], { env: { ENGINES: e } }),
      // WebKit stores no Secure cookie on http (probe P3; phase-8-auth.md: local sign-in is a
      // Chromium/Firefox check), so it can't Save on the Testing instance: it plays a code saved
      // from Node and copies its Show JSON anonymously; a fresh Chromium profile applies and saves.
      e === 'webkit'
        ? s(`roundtrip-${e}`, ['gate-roundtrip.mjs', e, codes.show], { env: { JSON_ENGINE: 'chromium' }, timeoutS: 1200 })
        : s(`roundtrip-${e}`, ['gate-roundtrip.mjs', e], { env: { JSON_ENGINE: e }, timeoutS: 1200 }),
      s(`keyboard-${e}`, ['gate-keyboard.mjs'], { env: { ENGINES: e }, gate: 'report' }),
      s(`reduced-motion-${e}`, ['gate-reduced-motion.mjs'], { env: { ENGINES: e }, gate: 'report' }),
      s(`follow-${e}`, ['gate-follow.mjs'], { env: { ENGINES: e }, gate: 'report' }),
    );
  }
  // T2 fingerprints: no server needed (a blank page per engine). The compare steps read the run
  // steps' results from OUT_DIR, so each compare runs after its run.
  for (const e of ['chromium', 'firefox', 'webkit']) {
    steps.push(
      s(`fingerprints-run-${e}`, ['fingerprints.mjs'], { env: { ENGINES: e }, timeoutS: 1200 }),
      s(`fingerprints-match-${e}`, ['fingerprints.mjs'], { env: { ENGINES: e, MODE: 'compare' }, gate: e === 'chromium' ? 'fail' : 'report', timeoutS: 120 }),
    );
  }
  steps.push(
    s('fingerprints-neg-mismatch', ['fingerprints.mjs'], { env: { ENGINES: 'chromium', MODE: 'compare', FP_NEG: 'bump' }, expectExit: 1, mustSay: /fingerprint\.ledgerHash: expected \d+, got \d+/, timeoutS: 120 }),
    s('fingerprints-neg-crash', ['fingerprints.mjs'], { env: { ENGINES: 'chromium', FP_NEG: 'crash', FP_CASES: 'minimal', FP_TAG: 'neg' }, expectExit: 1, mustSay: /CRASH {3}chromium minimal: .*FP_NEG crash/, timeoutS: 300 }),
  );
  if (tier === 'final') {
    for (const e of ['chromium', 'firefox', 'webkit']) {
      const env = { ENGINES: e, FP_CASES: 'at-maximums', FP_TAG: 'final' };
      steps.push(
        s(`fingerprints-max-run-${e}`, ['fingerprints.mjs'], { env, timeoutS: 2400 }),
        s(`fingerprints-max-match-${e}`, ['fingerprints.mjs'], { env: { ...env, MODE: 'compare' }, gate: e === 'chromium' ? 'fail' : 'report', timeoutS: 120 }),
      );
    }
    steps.push(
      s('bench-warm-after', ['gate-warm.mjs', '$BASE', 'SAVE', 'after'], { gate: 'report', timeoutS: 900 }),
      s('bench-seek-node', [path.join(ROOT, 'tools', 'bench', 'bench.mjs'), 'done-when-60,realistic-600', '40000'], { gate: 'report', timeoutS: 900 }),
    );
  }
  steps.push(
    // Last: it spends the read limit, so anything after it would see 429s for a minute.
    s('headers-burst', ['-I', 'headers.py', '$PORT', codes.shell, codes.shellB, 'burst'], { cmd: 'python3' }),
  );
  return steps;
}
