#!/usr/bin/env node
/**
 * Writes every file under schema/fixtures/ (docs/fireworks-app/schema.md §12). Owner: Toad.
 *
 *   node schema/tools/generate-fixtures.mjs           write the fixtures
 *   node schema/tools/generate-fixtures.mjs --check   fail if any file on disk differs (or is extra)
 *
 * The expected `errors` below are transcribed from schema.md §6 and §12, NEVER from running a
 * validator: copying a validator's output would make the fixtures agree with themselves.
 *
 * Presets come from the shipped `presets.ts` (bundled on the fly with the web app's esbuild), so
 * `preset-*.json` is value for value. Boundary values come from `schema/limits.json`.
 *
 * Text that `JSON.stringify` can't produce is spliced in after serializing:
 *   - a string value "@@raw:<text>@@" becomes the bare JSON text <text> (`1.0`, `1e2`, `1e400`);
 *   - an object key "@@key:<k>@@" becomes the key <k> (only `__proto__`, which an object literal
 *     or spread would turn into a prototype instead of a key).
 * Every non-ASCII character is written as a \u escape so invisible characters (U+FEFF, U+0085)
 * survive editors and diffs.
 *
 * Needs Node 26 (`~/.nvm/versions/node/v26.5.0/bin` first on PATH) and `npm ci` in
 * src/web/fireworks-web (for esbuild).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIXTURES = join(ROOT, 'schema', 'fixtures');
const WEB = join(ROOT, 'src', 'web', 'fireworks-web');
const CHECK = process.argv.includes('--check');

// ---- inputs -------------------------------------------------------------------------------
const { build } = await import(join(WEB, 'node_modules', 'esbuild', 'lib', 'main.js'));
const bundle = await build({
  entryPoints: [join(WEB, 'src', 'engine', 'model', 'presets.ts')],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'neutral',
  logLevel: 'silent',
});
const { PRESETS } = await import(
  'data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64')
);
const LIMITS = JSON.parse(readFileSync(join(ROOT, 'schema', 'limits.json'), 'utf8'));
const min = (k) => LIMITS[k].min;
const max = (k) => LIMITS[k].max;

const clone = (v) => structuredClone(v);
const slug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
const raw = (text) => `@@raw:${text}@@`;
const peony = () => clone(PRESETS[0]);
const peonyBreak = () => clone(PRESETS[0].breaks[0]);
/** The embedded form of a shell: a ShellDocument without `sky` (§4.2). */
const embedded = (shell) => {
  const s = clone(shell);
  delete s.sky;
  return s;
};
const minimalShow = () => ({
  version: 1,
  name: 'Minimal show',
  sky: { gravity: 160, wind: 0 },
  duration: 10,
  shells: { s1: embedded(peony()) },
  cues: [{ id: 'c1', t: 1, shell: 's1', x: 0.5, seed: 12345 }],
});
const withShell = (mutate) => {
  const d = peony();
  mutate(d);
  return d;
};
const withBreak = (mutate) =>
  withShell((d) => {
    mutate(d.breaks[0]);
  });
const withShow = (mutate) => {
  const d = minimalShow();
  mutate(d);
  return d;
};
const withCue = (mutate) => withShow((d) => mutate(d.cues[0]));
const BREAK_NUMERICS = ['stars', 'speed', 'changeAt', 'burn', 'drag', 'size', 'delay'];
const BREAK_FIELDS = [
  'pattern',
  'stars',
  'speed',
  'color1',
  'color2',
  'changeAt',
  'burn',
  'drag',
  'size',
  'trail',
  'effect',
  'delay',
];
const FIREWORK = '\u{1F386}'; // one astral code point, two UTF-16 units

// ---- fixture tables -----------------------------------------------------------------------
/** @type {{ dir: string, file: string, description: string, kind?: string, document?: unknown, errors?: [string, string][], body?: string, status?: number, compact?: boolean }[]} */
const out = [];
const valid = (kind, file, description, document, opts = {}) =>
  out.push({ dir: `valid/${kind}`, file, description, kind, document, ...opts });
const invalid = (kind, file, description, document, errors) =>
  out.push({ dir: `invalid/${kind}`, file, description, kind, document, errors });
/** opts: `contentType` (sent instead of application/json; 415 only), `byteMarkers` (see below). */
const serverOnly = (file, description, body, status, errors, opts = {}) =>
  out.push({ dir: 'server-only', file, description, body, status, errors, ...opts });
/** Replaces exactly one occurrence of `from`, so a splice that misses (or hits twice) fails loudly. */
const spliceOnce = (text, from, to) => {
  const at = text.indexOf(from);
  if (at < 0 || text.indexOf(from, at + 1) >= 0) throw new Error(`splice: ${from} must occur exactly once`);
  return text.slice(0, at) + to + text.slice(at + from.length);
};

// §12.2 valid shells
for (const preset of PRESETS) {
  valid(
    'shell',
    `preset-${slug(preset.name)}`,
    `The ${preset.name} preset, value for value from presets.ts, with no sky (absent sky is valid).`,
    clone(preset),
  );
}
valid(
  'shell',
  'with-sky',
  'A present sky is valid.',
  withShell((d) => (d.sky = { gravity: 220, wind: 15 })),
);
valid('shell', 'four-breaks-all-enums', 'Four breaks that together use every pattern, trail and effect, rainbow in color1, and both none and a palette color in color2.', {
  ...peony(),
  name: 'All enums',
  breaks: [
    { ...peonyBreak(), pattern: 'peony', color1: 'rainbow', color2: 'none', trail: 'none', effect: 'none' },
    { ...peonyBreak(), pattern: 'ring', color1: 'blue', color2: 'silver', trail: 'tail', effect: 'crackle' },
    { ...peonyBreak(), pattern: 'palm', color1: 'gold', color2: 'orange', trail: 'glitter', effect: 'crossette' },
    { ...peonyBreak(), pattern: 'heart', color1: 'pink', color2: 'white', trail: 'tail', effect: 'strobe' },
  ],
});
const boundaryBreak = (pick) => {
  const b = peonyBreak();
  for (const f of BREAK_NUMERICS) b[f] = pick(`break.${f}`);
  return b;
};
valid('shell', 'at-minimums', 'Every numeric field (shell, break, sky) at its minimum, one break.', {
  ...peony(),
  name: 'A',
  burstHeight: min('shell.burstHeight'),
  angleJitter: min('shell.angleJitter'),
  sky: { gravity: min('sky.gravity'), wind: min('sky.wind') },
  breaks: [boundaryBreak(min)],
});
valid('shell', 'at-maximums', 'Every numeric field (shell, break, sky) at its maximum, four breaks, an 80-character name.', {
  ...peony(),
  name: 'M'.repeat(max('shell.name.codePoints')),
  burstHeight: max('shell.burstHeight'),
  angleJitter: max('shell.angleJitter'),
  sky: { gravity: max('sky.gravity'), wind: max('sky.wind') },
  breaks: Array.from({ length: max('shell.breaks.count') }, () => boundaryBreak(max)),
});
valid('shell', 'negative-wind', 'wind: -80 is valid.', withShell((d) => (d.sky = { gravity: 160, wind: -80 })));
valid(
  'shell',
  'number-forms',
  'version 1.0 and stars 1e2 are integers by value; angleJitter 4.5 is valid because angleJitter is not an integer field.',
  withShell((d) => {
    d.version = raw('1.0');
    d.angleJitter = 4.5;
    d.breaks[0].stars = raw('1e2');
  }),
);
valid('shell', 'off-step-values', 'Values off the slider step are valid (burstHeight 0.333, speed 61).', withShell((d) => {
  d.burstHeight = 0.333;
  d.breaks[0].speed = 61;
}));
valid('shell', 'name-80-astral', 'A name of 80 emoji (160 UTF-16 units) is valid: length is counted in code points.', withShell((d) => (d.name = FIREWORK.repeat(80))));
valid('shell', 'name-one-char', 'A one-character name is valid.', withShell((d) => (d.name = 'a')));
valid('shell', 'name-interior-space', 'Interior whitespace is kept as typed.', withShell((d) => (d.name = 'Big  Red One')));
valid('shell', 'name-interior-bom', 'U+FEFF inside a name is kept; it is trimmed only at the edges.', withShell((d) => (d.name = 'Pe﻿ony')));

// §12.2 valid shows
valid('show', 'minimal', 'One shell, one cue, no cue burstHeight.', minimalShow());
valid('show', 'at-minimums', 'duration, sky and every cue numeric at its minimum; one shell and one cue (the minimum cue count).', withShow((d) => {
  d.duration = min('show.duration');
  d.sky = { gravity: min('sky.gravity'), wind: min('sky.wind') };
  d.cues = [{ id: 'c1', t: min('cue.t'), shell: 's1', x: min('cue.x'), burstHeight: min('cue.burstHeight'), seed: min('cue.seed') }];
}));
valid('show', 'cue-burst-height', 'A cue with its own burstHeight.', withCue((c) => (c.burstHeight = 0.4)));
valid('show', 'cue-at-duration', 'A cue at t equal to duration and another at t 0; x at both ends.', withShow((d) => {
  d.cues = [
    { id: 'c1', t: d.duration, shell: 's1', x: 1, seed: 1 },
    { id: 'c2', t: 0, shell: 's1', x: 0, seed: 2 },
  ];
}));
valid('show', 'same-step-cues', 'Two cues with t 1.0 and 1.004 (both round to step 120), ids out of array order.', withShow((d) => {
  d.cues = [
    { id: 'b', t: 1.004, shell: 's1', x: 0.25, seed: 7 },
    { id: 'a', t: raw('1.0'), shell: 's1', x: 0.75, seed: 8 },
  ];
}));
valid('show', 'seed-extremes', 'Seeds at the int32 extremes, and 1293847.0 (an integer by value).', withShow((d) => {
  d.cues = [
    { id: 'lo', t: 1, shell: 's1', x: 0.2, seed: -2147483648 },
    { id: 'hi', t: 2, shell: 's1', x: 0.5, seed: 2147483647 },
    { id: 'dot', t: 3, shell: 's1', x: 0.8, seed: raw('1293847.0') },
  ];
}));
valid('show', 'unreferenced-shell', 'A shell that no cue uses is allowed.', withShow((d) => {
  d.shells.s2 = embedded(PRESETS[4]);
}));
valid('show', 'key-edges', 'A 12-character shell key and cue id using - and _.', withShow((d) => {
  d.shells = { 'Ab-_cdefghij': embedded(peony()) };
  d.cues = [{ id: 'Z9_-z9_-z9_-', t: 1, shell: 'Ab-_cdefghij', x: 0.5, seed: 12345 }];
}));

// valid/show/done-when-60s-50: the Phase 6 Done-when show (acceptance/phase-6.md 6b.1). Value for
// value the same document as the web stand-in `doneWhenShow()` (app/testing/show-fixtures.ts).
{
  const fourBreak = embedded(PRESETS[9]); // Triple Break + one more break
  fourBreak.name = 'Four Break';
  fourBreak.breaks.push({ ...clone(fourBreak.breaks[0]), color1: 'purple', delay: 0.9 });
  const shells = {
    s1: embedded(PRESETS[5]), // Crossette
    s2: embedded(PRESETS[6]), // Crackling Heart (crackle)
    s3: embedded(PRESETS[2]), // Willow (glitter)
    s4: embedded(PRESETS[7]), // Strobe
    s5: fourBreak,
    s6: embedded(PRESETS[0]), // Peony, used by no cue
  };
  const keys = ['s1', 's2', 's3', 's4', 's5'];
  const cues = [];
  for (let i = 1; i <= 50; i++) {
    const cue = {
      id: `c${i}`,
      t: Math.round(((i - 1) * 60 * 10) / 49) / 10,
      shell: keys[(i - 1) % keys.length],
      x: i === 1 ? 0 : i === 50 ? 1 : ((i * 37) % 101) / 100,
      seed: Math.imul(i, 2654435761 | 0),
    };
    if (i % 7 === 0) cue.burstHeight = [0.5, 0.6, 0.7][i % 3];
    cues.push(cue);
  }
  cues[1].t = cues[9].t; // c2 with c10: same step, array order the reverse of ordinal id order
  cues[2].t = cues[19].t; // c3 with c20: likewise
  const show = { version: 1, name: 'Done-when 60s', sky: { gravity: 160, wind: 12 }, duration: 60, shells, cues };
  // Guard the 6b.1 shape, so an edit above can't quietly drop a required feature.
  const ts = cues.map((c) => c.t);
  const ok =
    cues.length === 50 &&
    ts.includes(60) && ts.includes(0) && Math.max(...ts) === 60 &&
    cues.some((c) => c.x === 0) && cues.some((c) => c.x === 1) &&
    cues.some((c) => 'burstHeight' in c) && cues.some((c) => !('burstHeight' in c)) &&
    Math.round(cues[1].t * 120) === Math.round(cues[9].t * 120) &&
    Math.round(cues[2].t * 120) === Math.round(cues[19].t * 120) &&
    !cues.some((c) => c.shell === 's6') &&
    fourBreak.breaks.length === 4;
  if (!ok) throw new Error('done-when-60s-50 no longer meets acceptance/phase-6.md 6b.1');
  valid('show', 'done-when-60s-50', 'The Phase 6 Done-when show (acceptance/phase-6.md 6b.1): duration 60, 50 cues, one at t 0 and one at t 60, x at 0 and 1, two same-step pairs in reverse ordinal order (c2/c10, c3/c20), cues with and without burstHeight, wind 12, crossette, crackle, glitter, strobe and four-break shells, and one unused shell (s6).', show);
}

// valid/show/at-maximums: 32 shells x 4 breaks, 1000 cues, duration 600, worst-case lengths.
{
  let s = 0x9e3779b9;
  const rnd = () => {
    // mulberry32: deterministic, so the file is reproducible byte for byte
    s = (s + 0x6d2b79f5) | 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  // A long double strictly inside [lo, hi]: shortest round-trip text is usually 16-17 digits.
  const long = (lo, hi) => lo + (hi - lo) * (0.001 + 0.998 * rnd());
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const pad = (prefix, i) => prefix + String(i).padStart(11, '0');
  const name = FIREWORK.repeat(80);
  const PAT = ['peony', 'ring', 'palm', 'heart'];
  const C1 = ['red', 'orange', 'gold', 'green', 'cyan', 'blue', 'purple', 'pink', 'white', 'silver', 'rainbow'];
  const C2 = ['none', 'red', 'orange', 'gold', 'green', 'cyan', 'blue', 'purple', 'pink', 'white', 'silver'];
  const TR = ['none', 'tail', 'glitter'];
  const EF = ['none', 'crackle', 'crossette', 'strobe'];
  const shells = {};
  const keys = [];
  for (let i = 0; i < max('show.shells.count'); i++) {
    const key = pad('s', i);
    keys.push(key);
    shells[key] = {
      version: 1,
      name,
      burstHeight: long(min('shell.burstHeight'), max('shell.burstHeight')),
      angleJitter: long(min('shell.angleJitter'), max('shell.angleJitter')),
      breaks: Array.from({ length: max('shell.breaks.count') }, () => ({
        pattern: pick(PAT),
        stars: max('break.stars') - Math.floor(rnd() * 10),
        speed: long(min('break.speed'), max('break.speed')),
        color1: pick(C1),
        color2: pick(C2),
        changeAt: long(min('break.changeAt'), max('break.changeAt')),
        burn: long(min('break.burn'), max('break.burn')),
        drag: long(min('break.drag'), max('break.drag')),
        size: long(min('break.size'), max('break.size')),
        trail: pick(TR),
        effect: pick(EF),
        delay: long(min('break.delay'), max('break.delay')),
      })),
    };
  }
  const duration = max('show.duration');
  const cues = Array.from({ length: max('show.cues.count') }, (_, i) => ({
    id: pad('c', i),
    t: long(0, duration),
    shell: keys[i % keys.length],
    x: long(min('cue.x'), max('cue.x')),
    burstHeight: long(min('cue.burstHeight'), max('cue.burstHeight')),
    seed: -2147483648 + Math.floor(rnd() * 4294967296),
  }));
  valid(
    'show',
    'at-maximums',
    'Every show maximum at once: 32 shells x 4 breaks, 1000 cues each with burstHeight, duration 600, 80-emoji names, 12-character keys and ids, long numbers. Also the 413-boundary input: its compact {kind, document} body with \\u-escaped non-ASCII must stay under 262144 bytes. Generated by schema/tools/generate-fixtures.mjs.',
    { version: 1, name, sky: { gravity: long(min('sky.gravity'), max('sky.gravity')), wind: long(min('sky.wind'), max('sky.wind')) }, duration, shells, cues },
    { compact: true },
  );
}

// §12.3 invalid shells: structure
invalid('shell', 'root-array', 'The document is an array.', [], [['', 'not-object']]);
invalid('shell', 'root-string', 'The document is a string.', 'peony', [['', 'not-object']]);
invalid('shell', 'breaks-missing', 'No breaks key.', withShell((d) => delete d.breaks), [['breaks', 'break-count']]);
invalid('shell', 'breaks-empty', 'breaks is an empty array.', withShell((d) => (d.breaks = [])), [['breaks', 'break-count']]);
invalid('shell', 'breaks-not-array', 'breaks is an object.', withShell((d) => (d.breaks = {})), [['breaks', 'break-count']]);
invalid('shell', 'breaks-five', 'Five valid breaks (one more than the maximum).', withShell((d) => (d.breaks = Array.from({ length: 5 }, peonyBreak))), [['breaks', 'break-count']]);
invalid('shell', 'breaks-five-one-bad', 'Five breaks, one with stars 9999: only break-count, because no break is walked.', withShell((d) => {
  d.breaks = Array.from({ length: 5 }, peonyBreak);
  d.breaks[2].stars = 9999;
}), [['breaks', 'break-count']]);
invalid('shell', 'break-not-object', 'A break that is a number.', withShell((d) => (d.breaks = [1])), [['breaks[0]', 'not-object']]);
invalid('shell', 'break-empty', 'An empty break object: every break field is missing.', withShell((d) => (d.breaks = [{}])), BREAK_FIELDS.map((f) => [`breaks[0].${f}`, 'missing']));
invalid('shell', 'sky-not-object', 'sky is a string.', withShell((d) => (d.sky = 'calm')), [['sky', 'not-object']]);
invalid('shell', 'sky-null', 'sky is null (a stored document never contains null).', withShell((d) => (d.sky = null)), [['sky', 'missing']]);
invalid('shell', 'sky-empty', 'sky is an empty object.', withShell((d) => (d.sky = {})), [['sky.gravity', 'missing'], ['sky.wind', 'missing']]);

// version
invalid('shell', 'version-99', 'version 99.', withShell((d) => (d.version = 99)), [['version', 'version']]);
invalid('shell', 'version-string', 'version "1" (a string).', withShell((d) => (d.version = '1')), [['version', 'version']]);
invalid('shell', 'version-fraction', 'version 1.5.', withShell((d) => (d.version = 1.5)), [['version', 'version']]);
invalid('shell', 'version-bool', 'version true (listed in schema.md §6.3).', withShell((d) => (d.version = true)), [['version', 'version']]);
invalid('shell', 'version-missing', 'No version key.', withShell((d) => delete d.version), [['version', 'missing']]);
invalid('shell', 'version-null', 'version null.', withShell((d) => (d.version = null)), [['version', 'missing']]);

// unknown and never-persisted
invalid('shell', 'unknown-root', 'An unknown root key.', withShell((d) => (d.foo = 1)), [['foo', 'unknown-property']]);
invalid('shell', 'unknown-break', 'An unknown break key.', withBreak((b) => (b.glow = true)), [['breaks[0].glow', 'unknown-property']]);
invalid('shell', 'unknown-sky', 'An unknown sky key.', withShell((d) => (d.sky = { gravity: 160, wind: 0, turbulence: 3 })), [['sky.turbulence', 'unknown-property']]);
invalid('shell', 'never-persisted', 'Device and session state (starBudget, persistence, mode, reduceFlashing) is never stored.', withShell((d) => {
  d.starBudget = 1;
  d.persistence = 0.78;
  d.mode = 'loop';
  d.reduceFlashing = false;
}), [['mode', 'unknown-property'], ['persistence', 'unknown-property'], ['reduceFlashing', 'unknown-property'], ['starBudget', 'unknown-property']]);
invalid('shell', 'wrong-case-key', 'Stars instead of stars: property names are case-sensitive.', withBreak((b) => {
  b.Stars = 100;
  delete b.stars;
}), [['breaks[0].Stars', 'unknown-property'], ['breaks[0].stars', 'missing']]);
// §6.2 rule 11: a name that isn't ^[A-Za-z_][A-Za-z0-9_-]*$ is written parent["name"], with only
// \ and " escaped and each unpaired surrogate written as U+FFFD.
invalid('shell', 'unknown-key-dot', 'A root key "a.b": a name with a dot is written in brackets (schema.md §6.2 rule 11).', withShell((d) => (d['a.b'] = 1)), [['["a.b"]', 'unknown-property']]);
invalid('shell', 'unknown-key-empty', 'A root key "" (the empty name): its path is [""], never the root path "".', withShell((d) => (d[''] = 1)), [['[""]', 'unknown-property']]);
invalid('shell', 'unknown-key-quote', 'A break key a"b: inside the brackets the quote is written \\" (and nothing else is escaped).', withBreak((b) => (b['a"b'] = 1)), [['breaks[0]["a\\"b"]', 'unknown-property']]);
invalid('shell', 'unknown-key-lone-surrogate', 'A break key "st\\ud800ars" (an unpaired surrogate) beside stars: the path writes the surrogate as U+FFFD, so it stays well-formed Unicode.', withBreak((b) => (b['st\uD800ars'] = 1)), [['breaks[0]["st\uFFFDars"]', 'unknown-property']]);
invalid('shell', 'unknown-value-not-walked', 'A root key glow whose value is {"stars": 9999}: the value of an unknown property is never walked (schema.md §6.2 rule 10).', withShell((d) => (d.glow = { stars: 9999 })), [['glow', 'unknown-property']]);

// enums
invalid('shell', 'pattern-unknown', 'pattern "willow".', withBreak((b) => (b.pattern = 'willow')), [['breaks[0].pattern', 'enum']]);
invalid('shell', 'pattern-case', 'pattern "Peony": enum values are lowercase and exact.', withBreak((b) => (b.pattern = 'Peony')), [['breaks[0].pattern', 'enum']]);
invalid('shell', 'trail-unknown', 'trail "smoke".', withBreak((b) => (b.trail = 'smoke')), [['breaks[0].trail', 'enum']]);
invalid('shell', 'effect-unknown', 'effect "glitter" (glitter is a trail).', withBreak((b) => (b.effect = 'glitter')), [['breaks[0].effect', 'enum']]);
invalid('shell', 'color1-none', 'color1 "none" (only color2 may be none).', withBreak((b) => (b.color1 = 'none')), [['breaks[0].color1', 'enum']]);
invalid('shell', 'color2-rainbow', 'color2 "rainbow" (only color1 may be rainbow).', withBreak((b) => (b.color2 = 'rainbow')), [['breaks[0].color2', 'enum']]);
invalid('shell', 'color-hex', 'color1 as hex: colors are stored by name.', withBreak((b) => (b.color1 = '#ff0000')), [['breaks[0].color1', 'enum']]);
invalid('shell', 'pattern-number', 'pattern 1: a non-string enum value is enum, not type.', withBreak((b) => (b.pattern = 1)), [['breaks[0].pattern', 'enum']]);

// numbers
invalid('shell', 'stars-401', 'stars one above the maximum.', withBreak((b) => (b.stars = 401)), [['breaks[0].stars', 'out-of-range']]);
invalid('shell', 'stars-3', 'stars one below the minimum.', withBreak((b) => (b.stars = 3)), [['breaks[0].stars', 'out-of-range']]);
invalid('shell', 'stars-400-4', 'stars 400.4: the range is tested on the raw value, so out-of-range wins over not-integer.', withBreak((b) => (b.stars = 400.4)), [['breaks[0].stars', 'out-of-range']]);
invalid('shell', 'stars-fraction', 'stars 120.5: a fraction inside the range.', withBreak((b) => (b.stars = 120.5)), [['breaks[0].stars', 'not-integer']]);
invalid('shell', 'stars-string', 'stars "120" (a string).', withBreak((b) => (b.stars = '120')), [['breaks[0].stars', 'type']]);
invalid('shell', 'stars-bool', 'stars true.', withBreak((b) => (b.stars = true)), [['breaks[0].stars', 'type']]);
invalid('shell', 'break-numbers-strings', 'All seven break numerics as strings: one type issue each.', withBreak((b) => {
  for (const f of BREAK_NUMERICS) b[f] = String(b[f]);
}), BREAK_NUMERICS.map((f) => [`breaks[0].${f}`, 'type']));
invalid('shell', 'break-numbers-out', 'speed, changeAt, burn and delay above their maximums; drag and size below their minimums.', withBreak((b) => {
  Object.assign(b, { speed: 405, changeAt: 0.96, burn: 5.1, drag: -0.01, size: 0.39, delay: 2.55 });
}), [['speed'], ['changeAt'], ['burn'], ['drag'], ['size'], ['delay']].map(([f]) => [`breaks[0].${f}`, 'out-of-range']));
invalid('shell', 'break-numbers-out-other-side', 'The other side of break-numbers-out: speed, changeAt, burn and delay below their minimums; drag and size above their maximums (schema.md §5.2 item 4).', withBreak((b) => {
  Object.assign(b, { speed: 55, changeAt: 0.05, burn: 0.25, drag: 4.05, size: 3.05, delay: 0.05 });
}), ['speed', 'changeAt', 'burn', 'drag', 'size', 'delay'].map((f) => [`breaks[0].${f}`, 'out-of-range']));
invalid('shell', 'burst-height-high', 'burstHeight one ulp above 0.85.', withShell((d) => (d.burstHeight = 0.8500000000000001)), [['burstHeight', 'out-of-range']]);
invalid('shell', 'burst-height-low', 'burstHeight 0.29.', withShell((d) => (d.burstHeight = 0.29)), [['burstHeight', 'out-of-range']]);
invalid('shell', 'burst-height-infinite', 'burstHeight 1e400 parses to Infinity: a non-finite number is a type error.', withShell((d) => (d.burstHeight = raw('1e400'))), [['burstHeight', 'type']]);
invalid('shell', 'angle-jitter-21', 'angleJitter 21.', withShell((d) => (d.angleJitter = 21)), [['angleJitter', 'out-of-range']]);
invalid('shell', 'angle-jitter-negative', 'angleJitter -1.', withShell((d) => (d.angleJitter = -1)), [['angleJitter', 'out-of-range']]);
invalid('shell', 'angle-jitter-null', 'angleJitter null.', withShell((d) => (d.angleJitter = null)), [['angleJitter', 'missing']]);
invalid('shell', 'gravity-39', 'sky.gravity 39.', withShell((d) => (d.sky = { gravity: 39, wind: 0 })), [['sky.gravity', 'out-of-range']]);
invalid('shell', 'gravity-401', 'sky.gravity 401.', withShell((d) => (d.sky = { gravity: 401, wind: 0 })), [['sky.gravity', 'out-of-range']]);
invalid('shell', 'wind-81', 'sky.wind 81.', withShell((d) => (d.sky = { gravity: 160, wind: 81 })), [['sky.wind', 'out-of-range']]);
invalid('shell', 'wind-minus-81', 'sky.wind -81.', withShell((d) => (d.sky = { gravity: 160, wind: -81 })), [['sky.wind', 'out-of-range']]);

// names
const nameCase = (file, description, name, code) =>
  invalid('shell', file, description, withShell((d) => (name === undefined ? delete d.name : (d.name = name))), [['name', code]]);
nameCase('name-200', 'A name of 200 ASCII characters.', 'x'.repeat(200), 'too-long');
nameCase('name-81-astral', 'A name of 81 emoji.', FIREWORK.repeat(81), 'too-long');
nameCase('name-empty', 'An empty name.', '', 'missing');
nameCase('name-blank', 'A name of three spaces (blank saves as "Custom" in lenient mode).', '   ', 'missing');
nameCase('name-missing', 'No name key.', undefined, 'missing');
nameCase('name-number', 'name 123.', 123, 'type');
nameCase('name-leading-space', 'A leading space is trimmed.', ' Peony', 'name-format');
nameCase('name-trailing-newline', 'A trailing newline is trimmed.', 'Peony\n', 'name-format');
nameCase('name-tab', 'An interior tab is a control character and is removed.', 'Pe\tony', 'name-format');
nameCase('name-nul', 'An interior NUL is removed (Postgres jsonb cannot store it).', 'Pe\u0000ony', 'name-format');
nameCase('name-only-controls', 'Only control characters: cleaned to empty, so missing (one issue; missing wins).', '\u0000\u0001', 'missing');
nameCase('name-bom', 'A leading U+FEFF is trimmed (C# string.Trim() would miss it).', '﻿Peony', 'name-format');
nameCase('name-nel', 'A leading U+0085 (NEL, category Cc) is removed.', '\u0085Peony', 'name-format');
nameCase('name-lone-surrogate', 'An unpaired surrogate is removed.', 'Pe\uD800ony', 'name-format');
nameCase('name-long-and-padded', 'A leading space plus 85 ASCII characters: one issue, too-long beats name-format.', ' ' + 'y'.repeat(85), 'too-long');

// several at once
invalid('shell', 'mixed', 'An error and two adjustments in one document: errors and adjustments are both reported.', withShell((d) => {
  d.version = 99;
  d.breaks[0].stars = 401;
  d.foo = 1;
}), [['breaks[0].stars', 'out-of-range'], ['foo', 'unknown-property'], ['version', 'version']]);

// §12.3 invalid shows (base: valid/show/minimal.json)
invalid('show', 'show-version-2', 'Show version 2.', withShow((d) => (d.version = 2)), [['version', 'version']]);
invalid('show', 'show-sky-missing', 'No sky: sky is required in a show.', withShow((d) => delete d.sky), [['sky', 'missing']]);
invalid('show', 'show-duration-missing', 'No duration.', withShow((d) => delete d.duration), [['duration', 'missing']]);
invalid('show', 'show-duration-601', 'duration 601.', withShow((d) => (d.duration = 601)), [['duration', 'out-of-range']]);
invalid('show', 'show-duration-0', 'duration 0.', withShow((d) => (d.duration = 0)), [['duration', 'out-of-range']]);
invalid('show', 'show-never-persisted', 'Playback mode is never stored.', withShow((d) => (d.mode = 'show')), [['mode', 'unknown-property']]);
invalid('show', 'show-name-blank', 'A blank show name.', withShow((d) => (d.name = ' ')), [['name', 'missing']]);
invalid('show', 'show-empty', '0 shells and 0 cues: an empty show cannot be saved (Skyler, Q4). No cue means no unknown-shell, and no shell rule fires.', withShow((d) => {
  d.shells = {};
  d.cues = [];
}), [['cues', 'cue-count']]);
invalid('show', 'cues-empty', 'cues: [] with the minimal show\'s shell kept (now unreferenced).', withShow((d) => (d.cues = [])), [['cues', 'cue-count']]);
invalid('show', 'shells-not-object', 'shells is an array: only not-object, because unknown-shell is not checked when shells was not walked.', withShow((d) => (d.shells = [])), [['shells', 'not-object']]);
invalid('show', 'shells-33', '33 shells: only shell-count, no shell walked and no unknown-shell.', withShow((d) => {
  d.shells = {};
  for (let i = 1; i <= 33; i++) d.shells[`s${i}`] = embedded(peony());
}), [['shells', 'shell-count']]);
invalid('show', 'shell-key-proto', 'An extra own key "__proto__" beside s1 (spliced into the text; it is a key, not a prototype).', withShow((d) => {
  d.shells['@@key:__proto__@@'] = embedded(peony());
}), [['shells', 'key-format']]);
invalid('show', 'shell-key-digit', 'An extra key "1abc" beside s1: keys start with a letter.', withShow((d) => (d.shells['1abc'] = embedded(peony()))), [['shells', 'key-format']]);
invalid('show', 'shell-key-13', 'An extra 13-character key beside s1.', withShow((d) => (d.shells.abcdefghijklm = embedded(peony()))), [['shells', 'key-format']]);
invalid('show', 'embedded-sky', 'An embedded shell with its own sky (the show sky wins; embedded sky is not allowed).', withShow((d) => (d.shells.s1.sky = { gravity: 160, wind: 0 })), [['shells.s1.sky', 'unknown-property']]);
invalid('show', 'embedded-version-missing', 'An embedded shell with no version.', withShow((d) => delete d.shells.s1.version), [['shells.s1.version', 'missing']]);
invalid('show', 'embedded-stars', 'An embedded shell with stars 401.', withShow((d) => (d.shells.s1.breaks[0].stars = 401)), [['shells.s1.breaks[0].stars', 'out-of-range']]);
invalid('show', 'embedded-not-object', 'An embedded shell that is a number: not-object at its path (§6.2 rule 5). s1 is still an own key of shells, so the cue raises no unknown-shell.', withShow((d) => (d.shells.s1 = 5)), [['shells.s1', 'not-object']]);
invalid('show', 'cues-not-array', 'cues is an object.', withShow((d) => (d.cues = {})), [['cues', 'cue-count']]);
invalid('show', 'cues-1001', '1001 valid cues: one cue-count, no cue walked.', withShow((d) => {
  d.cues = Array.from({ length: 1001 }, (_, i) => ({ id: `c${i}`, t: 1, shell: 's1', x: 0.5, seed: i }));
}), [['cues', 'cue-count']]);
invalid('show', 'cue-not-object', 'A cue that is a number.', withShow((d) => (d.cues = [1])), [['cues[0]', 'not-object']]);
invalid('show', 'cue-empty', 'An empty cue: every required cue field is missing (cue fields have no defaults).', withShow((d) => (d.cues = [{}])), ['id', 't', 'shell', 'x', 'seed'].map((f) => [`cues[0].${f}`, 'missing']));
invalid('show', 'cue-unknown-key', 'An unknown cue key.', withCue((c) => (c.color = 'red')), [['cues[0].color', 'unknown-property']]);
invalid('show', 'cue-id-format', 'cue id "c 1" (a space).', withCue((c) => (c.id = 'c 1')), [['cues[0].id', 'key-format']]);
invalid('show', 'cue-id-duplicate', 'Three cues all with id c1: duplicate-id at the second and later.', withShow((d) => {
  d.cues = [1, 2, 3].map((n) => ({ id: 'c1', t: n, shell: 's1', x: 0.5, seed: n }));
}), [['cues[1].id', 'duplicate-id'], ['cues[2].id', 'duplicate-id']]);
invalid('show', 'cue-unknown-shell', 'A cue naming a shell key that does not exist.', withCue((c) => (c.shell = 's9')), [['cues[0].shell', 'unknown-shell']]);
invalid('show', 'cue-shell-constructor', 'A cue naming "constructor": the prototype-key trap (§6.6).', withCue((c) => (c.shell = 'constructor')), [['cues[0].shell', 'unknown-shell']]);
invalid('show', 'cue-t-negative', 'cue t -0.1.', withCue((c) => (c.t = -0.1)), [['cues[0].t', 'out-of-range']]);
invalid('show', 'cue-t-past-duration', 'duration 10 and cue t 10.5.', withShow((d) => {
  d.duration = 10;
  d.cues[0].t = 10.5;
}), [['cues[0].t', 'out-of-range']]);
invalid('show', 'cue-x-high', 'cue x 1.01.', withCue((c) => (c.x = 1.01)), [['cues[0].x', 'out-of-range']]);
invalid('show', 'cue-x-negative', 'cue x -0.01.', withCue((c) => (c.x = -0.01)), [['cues[0].x', 'out-of-range']]);
invalid('show', 'cue-burst-height-null', 'cue burstHeight null (absent is the shell\'s; null is never stored).', withCue((c) => (c.burstHeight = null)), [['cues[0].burstHeight', 'missing']]);
invalid('show', 'cue-burst-height-high', 'cue burstHeight 0.9.', withCue((c) => (c.burstHeight = 0.9)), [['cues[0].burstHeight', 'out-of-range']]);
invalid('show', 'cue-burst-height-low', 'cue burstHeight 0.29.', withCue((c) => (c.burstHeight = 0.29)), [['cues[0].burstHeight', 'out-of-range']]);
invalid('show', 'cue-seed-fraction', 'seed 1.5: seeds are never rounded.', withCue((c) => (c.seed = 1.5)), [['cues[0].seed', 'not-integer']]);
invalid('show', 'cue-seed-overflow', 'seed 2147483648 (int32 max + 1): seeds are never clamped.', withCue((c) => (c.seed = 2147483648)), [['cues[0].seed', 'out-of-range']]);
invalid('show', 'cue-seed-underflow', 'seed -2147483649 (int32 min - 1).', withCue((c) => (c.seed = -2147483649)), [['cues[0].seed', 'out-of-range']]);
invalid('show', 'cue-seed-string', 'seed "1" (a string).', withCue((c) => (c.seed = '1')), [['cues[0].seed', 'type']]);
invalid('show', 'show-sky-empty', 'sky: {} in a show: gravity and wind have no defaults in a show sky (schema.md §6.2 rule 9).', withShow((d) => (d.sky = {})), [['sky.gravity', 'missing'], ['sky.wind', 'missing']]);
invalid('show', 'shells-missing', 'No shells key: missing (a required field with no default), not shell-count. shells is not walked, so the cue raises no unknown-shell.', withShow((d) => delete d.shells), [['shells', 'missing']]);
invalid('show', 'shells-null', 'shells: null reads as absent: missing only, no unknown-shell.', withShow((d) => (d.shells = null)), [['shells', 'missing']]);
invalid('show', 'shell-keys-two-bad', 'Extra keys "1abc" and "a b" beside s1: one key-format per bad key.', withShow((d) => {
  d.shells['1abc'] = embedded(peony());
  d.shells['a b'] = embedded(peony());
}), [['shells', 'key-format'], ['shells', 'key-format']]);
invalid('show', 'cue-names-bad-key', 'An extra key "1abc" beside s1, and the cue names "1abc": a key that failed key-format is not in the key set, so the cue is unknown-shell too.', withShow((d) => {
  d.shells['1abc'] = embedded(peony());
  d.cues[0].shell = '1abc';
}), [['cues[0].shell', 'unknown-shell'], ['shells', 'key-format']]);
invalid('show', 'embedded-version-2', 'An embedded shell with version 2: reported at its path, and the walk continues (schema.md §6.2 rule 10).', withShow((d) => (d.shells.s1.version = 2)), [['shells.s1.version', 'version']]);
invalid('show', 'embedded-sky-bad-values', 'An embedded sky {gravity: 9999, wind: "x"}: unknown-property only, because the value of an unknown property is never walked.', withShow((d) => (d.shells.s1.sky = { gravity: 9999, wind: 'x' })), [['shells.s1.sky', 'unknown-property']]);
invalid('show', 'cues-missing', 'No cues key: the same error as cues: [].', withShow((d) => delete d.cues), [['cues', 'cue-count']]);
invalid('show', 'cues-null', 'cues: null: cue-count.', withShow((d) => (d.cues = null)), [['cues', 'cue-count']]);
invalid('show', 'cue-id-duplicate-later', 'Cue ids c1, c2, c1: duplicate-id only at the later c1; the first occurrence is clean.', withShow((d) => {
  d.cues = ['c1', 'c2', 'c1'].map((id, i) => ({ id, t: i + 1, shell: 's1', x: 0.5, seed: i + 1 }));
}), [['cues[2].id', 'duplicate-id']]);
invalid('show', 'cue-id-format-twice', 'Two cues both with id "c 1": key-format on each, and no duplicate-id (an id that failed key-format joins no set).', withShow((d) => {
  d.cues = [1, 2].map((n) => ({ id: 'c 1', t: n, shell: 's1', x: 0.5, seed: n }));
}), [['cues[0].id', 'key-format'], ['cues[1].id', 'key-format']]);
invalid('show', 'cue-id-number', 'cue id 5 (a number): type only.', withCue((c) => (c.id = 5)), [['cues[0].id', 'type']]);
invalid('show', 'cue-shell-number', 'cue shell 5 (a number): type only, no unknown-shell.', withCue((c) => (c.shell = 5)), [['cues[0].shell', 'type']]);

// §12.4 server-only (body is the raw request text)
{
  const peonyText = JSON.stringify(peony());
  serverOnly('not-json', 'The body is not parseable JSON.', '{"kind":"shell","document":{', 400, [['', 'not-json']]);
  const dup = peonyText.replace('"stars":120,', '"stars":120,"stars":121,');
  if (dup === peonyText) throw new Error('duplicate-key splice missed');
  serverOnly('duplicate-key', 'The Peony preset with "stars" twice in break 0; the path is relative to the document. JSON.parse keeps the last value silently, so only the server can see this.', `{"kind":"shell","document":${dup}}`, 400, [['breaks[0].stars', 'duplicate-key']]);
  serverOnly('kind-unknown', 'kind "gallery".', `{"kind":"gallery","document":${peonyText}}`, 400, [['kind', 'enum']]);
  serverOnly('document-not-object', 'document is a number.', '{"kind":"shell","document":5}', 400, [['document', 'not-object']]);
  serverOnly('kind-mismatch', 'kind "shell" with valid/show/minimal.json as the document. The show sky is a valid shell sky, so it raises nothing.', `{"kind":"shell","document":${JSON.stringify(minimalShow())}}`, 400, [['angleJitter', 'missing'], ['breaks', 'break-count'], ['burstHeight', 'missing'], ['cues', 'unknown-property'], ['duration', 'unknown-property'], ['shells', 'unknown-property']]);
  const pad = ' '.repeat(150 * 1024);
  serverOnly('oversize', '300 KiB of JSON whitespace around a valid shell body: 413 before validation.', `${pad}{"kind":"shell","document":${peonyText}}${pad}`, 413, undefined);
  serverOnly('wrong-content-type', 'A valid shell body sent with Content-Type text/plain: 415 before anything else (schema.md §2.6 step 1). The harness sends contentType instead of application/json.', `{"kind":"shell","document":${peonyText}}`, 415, undefined, { contentType: 'text/plain' });

  // §2.6 step 3: bytes. A JSON string can't hold a raw 0xFF byte, so the body carries an ASCII
  // marker and `byteMarkers` maps it to hex bytes: the harness encodes `body` as UTF-8, then
  // replaces the marker's bytes with the listed bytes.
  const FF = '@@byte:ff@@';
  serverOnly('not-utf8', `A valid shell body with one raw 0xFF byte inside the name. The harness builds the bytes from body by replacing ${FF} with the byte 0xFF (byteMarkers). Without the byte the body is valid JSON, so not-json comes only from the UTF-8 gate.`, `{"kind":"shell","document":${spliceOnce(peonyText, '"name":"Peony"', `"name":"Pe${FF}ony"`)}}`, 400, [['', 'not-json']], { byteMarkers: { [FF]: 'ff' } });
  serverOnly('empty-body', 'An empty body (zero bytes): not-json.', '', 400, [['', 'not-json']]);
  serverOnly('body-not-object', 'The body is [] (valid JSON, not an object): not-object at the body root.', '[]', 400, [['', 'not-object']]);

  // §6.2 rule 12: one duplicate-key per repeated name per object; the last value is walked.
  const dupBody = (from, to) => `{"kind":"shell","document":${spliceOnce(peonyText, from, to)}}`;
  serverOnly('duplicate-key-three', 'stars three times in break 0 (120, 121, 122): one duplicate-key, however many repeats. The last value (122) is valid.', dupBody('"stars":120,', '"stars":120,"stars":121,"stars":122,'), 400, [['breaks[0].stars', 'duplicate-key']]);
  serverOnly('duplicate-key-last-wins', 'stars 120 then stars 401: the walk reads the last value, so out-of-range too.', dupBody('"stars":120,', '"stars":120,"stars":401,'), 400, [['breaks[0].stars', 'duplicate-key'], ['breaks[0].stars', 'out-of-range']]);
  serverOnly('duplicate-key-unknown', 'An unknown root key foo twice: one duplicate-key and one unknown-property.', dupBody('"version":1,', '"version":1,"foo":1,"foo":1,'), 400, [['foo', 'duplicate-key'], ['foo', 'unknown-property']]);
  serverOnly('duplicate-key-inside-unknown', 'foo: {"a": 1, "a": 2} at the document root: unknown-property only, because the value of an unknown property is not walked (no duplicate check inside it).', dupBody('"version":1,', '"version":1,"foo":{"a":1,"a":2},'), 400, [['foo', 'unknown-property']]);
  serverOnly('duplicate-key-escaped', 'stars and st\\u0061rs in break 0: names are compared after unescaping, so this is a duplicate.', dupBody('"stars":120,', '"stars":120,"st\\u0061rs":121,'), 400, [['breaks[0].stars', 'duplicate-key']]);
  {
    const showText = JSON.stringify(minimalShow());
    const s1 = `"s1":${JSON.stringify(embedded(peony()))}`;
    serverOnly('duplicate-shell-key', 'A show with "s1" twice in shells (both valid embedded Peony shells): duplicate-key at the shell key\'s path.', `{"kind":"show","document":${spliceOnce(showText, s1, `${s1},${s1}`)}}`, 400, [['shells.s1', 'duplicate-key']]);
  }
  const stars401 = spliceOnce(peonyText, '"stars":120,', '"stars":401,');
  serverOnly('duplicate-key-envelope', 'kind "shell" twice (both valid) and a document with stars 401: only the envelope issue, because the document is walked only when the envelope is clean (schema.md §2.6).', `{"kind":"shell","kind":"shell","document":${stars401}}`, 400, [['kind', 'duplicate-key']]);

  // §2.6 step 5: the envelope.
  serverOnly('kind-missing', 'No kind: missing.', `{"document":${peonyText}}`, 400, [['kind', 'missing']]);
  serverOnly('kind-number', 'kind 1: any value that is not "shell" or "show", including a non-string, is enum.', `{"kind":1,"document":${peonyText}}`, 400, [['kind', 'enum']]);
  serverOnly('document-missing', 'No document: missing.', '{"kind":"shell"}', 400, [['document', 'missing']]);
  serverOnly('document-null', 'document null: missing.', '{"kind":"shell","document":null}', 400, [['document', 'missing']]);
  serverOnly('envelope-unknown', 'An extra envelope key owner beside a valid shell: unknown-property at the envelope path (the owner is never a request field).', `{"kind":"shell","document":${peonyText},"owner":"x"}`, 400, [['owner', 'unknown-property']]);
  serverOnly('envelope-and-document', 'kind "gallery" and a document with stars 401: only (kind, enum); the document is not walked.', `{"kind":"gallery","document":${stars401}}`, 400, [['kind', 'enum']]);
}

// ---- serialize ----------------------------------------------------------------------------
const byPathThenCode = ([p1, c1], [p2, c2]) => (p1 < p2 ? -1 : p1 > p2 ? 1 : c1 < c2 ? -1 : c1 > c2 ? 1 : 0);
const escapeNonAscii = (text) =>
  text.replace(/[\u007f-￿]/g, (ch) => '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0'));
const splice = (text) =>
  text
    .replace(/"@@raw:([^"@]+)@@"/g, '$1')
    .replace(/"@@key:([^"@]+)@@"/g, '"$1"');

const files = new Map();
for (const f of out) {
  const obj =
    f.dir === 'server-only'
      ? { description: f.description, ...(f.contentType && { contentType: f.contentType }), body: f.body, ...(f.byteMarkers && { byteMarkers: f.byteMarkers }), status: f.status, ...(f.errors && { errors: f.errors.slice().sort(byPathThenCode).map(([path, code]) => ({ path, code })) }) }
      : { description: f.description, kind: f.kind, document: f.document, ...(f.errors && { errors: f.errors.slice().sort(byPathThenCode).map(([path, code]) => ({ path, code })) }) };
  const text = splice(escapeNonAscii(f.compact ? JSON.stringify(obj) : JSON.stringify(obj, null, 2))) + '\n';
  if (/@@(raw|key):/.test(text)) throw new Error(`${f.file}: unspliced sentinel`);
  JSON.parse(text); // every file must parse
  const rel = `${f.dir}/${f.file}.json`;
  if (files.has(rel)) throw new Error(`duplicate fixture ${rel}`);
  files.set(rel, text);
}

// The max show's size, as the 413 test will see it.
{
  const doc = JSON.parse(files.get('valid/show/at-maximums.json')).document;
  const body = JSON.stringify({ kind: 'show', document: doc });
  const escaped = escapeNonAscii(body);
  console.log(`valid/show/at-maximums: compact body ${Buffer.byteLength(body)} B as UTF-8, ${escaped.length} B with \\u escapes (limit 262144)`);
  if (escaped.length >= 262144) throw new Error('at-maximums body is not under 256 KiB');
}

const existing = (dir, acc = []) => {
  if (!existsSync(dir)) return acc;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) existing(p, acc);
    else if (e.name.endsWith('.json')) acc.push(relative(FIXTURES, p));
  }
  return acc;
};

if (CHECK) {
  const diffs = [];
  for (const [rel, text] of files) {
    const p = join(FIXTURES, rel);
    if (!existsSync(p)) diffs.push(`missing ${rel}`);
    else if (readFileSync(p, 'utf8') !== text) diffs.push(`differs ${rel}`);
  }
  for (const rel of existing(FIXTURES)) if (!files.has(rel)) diffs.push(`extra ${rel}`);
  if (diffs.length) {
    console.error(diffs.join('\n'));
    process.exit(1);
  }
  console.log(`check ok: ${files.size} fixtures match`);
} else {
  for (const rel of existing(FIXTURES)) if (!files.has(rel)) rmSync(join(FIXTURES, rel));
  for (const [rel, text] of files) {
    mkdirSync(dirname(join(FIXTURES, rel)), { recursive: true });
    writeFileSync(join(FIXTURES, rel), text);
  }
  mkdirSync(join(FIXTURES, 'upgrade'), { recursive: true });
  const counts = {};
  for (const rel of files.keys()) counts[dirname(rel)] = (counts[dirname(rel)] ?? 0) + 1;
  console.log(`wrote ${files.size} fixtures`, counts);
}
