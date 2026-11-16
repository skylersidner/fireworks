import {
  KEY_PATTERN,
  MAX_SHOW_CUES,
  MAX_SHOW_SHELLS,
  SHOW_LIMITS,
} from '../../../../engine/model/limits';
import { openShell } from '../../../../engine/model/open';
import { DEFAULT_SKY, type ShellDocument } from '../../../../engine/model/shell';
import {
  embeddedShell,
  orderCues,
  type EmbeddedShell,
  type ShowCue,
  type ShowDocument,
} from '../../../../engine/model/show';
import { DEFAULT_DURATION, NEW_SHOW_NAME } from './show-copy';

/**
 * Pure edits on a ShowDocument (phase-6.md §4). Every function returns a new document and never
 * mutates its input, so the builder's Undo can keep documents by reference. Nothing here clamps
 * silently past the schema: `t` stays in `0..duration`, `x` in `0..1`, and caps block instead.
 */

/** The first-visit show (phase-6.md §9.1): no shells, no cues. */
export function emptyShow(): ShowDocument {
  return {
    version: 1,
    name: NEW_SHOW_NAME,
    sky: { ...DEFAULT_SKY },
    duration: DEFAULT_DURATION,
    shells: {},
    cues: [],
  };
}

/** Snap for drags (0.1 s). */
export function snapTenth(t: number): number {
  return Math.round(t * 10) / 10;
}

/**
 * The playhead rounded **up** to 0.1 s (phase-6.md §4.1), so a new cue never lands before a step
 * the sim has run. The epsilon keeps an exact tenth (12.5) from rounding to 12.6.
 */
export function roundUpTenth(t: number): number {
  // `|| 0`: ceil of a tiny negative is -0, which isn't a time.
  return Math.ceil(t * 10 - 1e-7) / 10 || 0;
}

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/** A random int32 seed (phase-6.md §4.1). */
export function randomSeed(): number {
  const a = new Int32Array(1);
  crypto.getRandomValues(a);
  return a[0];
}

/** `c{n}` ids never reuse a deleted one (Peach N4): the counter after a load is max n + 1. */
export function nextCueIdAfter(show: Pick<ShowDocument, 'cues'>): number {
  let max = 0;
  for (const cue of show.cues) {
    const m = /^c([1-9][0-9]{0,9})$/.exec(cue.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}

/** The id for counter `n`, skipping any id already used (a hand-made or imported one). */
export function cueIdFor(
  show: Pick<ShowDocument, 'cues'>,
  n: number,
): { id: string; next: number } {
  const used = new Set(show.cues.map((c) => c.id));
  let k = n;
  while (used.has(`c${k}`)) k++;
  return { id: `c${k}`, next: k + 1 };
}

/** A shell as it goes into a show: upgraded, normalized, without `sky` (schema.md §4.1–4.2). */
export function embeddable(source: unknown): EmbeddedShell | null {
  const opened = openShell(source);
  if (!opened.ok) return null;
  const { version, name, burstHeight, angleJitter, breaks } = opened.shell;
  return { version, name, burstHeight, angleJitter, breaks: breaks.map((b) => ({ ...b })) };
}

function sameShell(a: EmbeddedShell, b: EmbeddedShell): boolean {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

function canonical(s: EmbeddedShell): unknown {
  const { version, name, burstHeight, angleJitter, breaks } = s;
  return {
    version,
    name,
    burstHeight,
    angleJitter,
    breaks: breaks.map((b) =>
      Object.fromEntries(
        Object.keys(b)
          .sort()
          .map((k) => [k, (b as unknown as Record<string, unknown>)[k]]),
      ),
    ),
  };
}

/** The key of an embedded shell deep-equal to `shell`, or null. */
export function findEmbedded(show: ShowDocument, shell: EmbeddedShell): string | null {
  for (const key of Object.keys(show.shells)) {
    if (sameShell(embeddedShell(show, key)!, shell)) return key;
  }
  return null;
}

/** `s{n}` with the lowest free n (keys are never shown). */
export function freeShellKey(show: ShowDocument): string {
  for (let n = 1; ; n++) {
    const key = `s${n}`;
    if (!Object.hasOwn(show.shells, key)) return key;
  }
}

export type EmbedResult =
  | { readonly ok: true; readonly show: ShowDocument; readonly key: string }
  | { readonly ok: false; readonly reason: 'shell-cap' };

/** Reuses an identical embedded shell, else adds it under a new key; blocked at 32 shells. */
export function embedShell(show: ShowDocument, shell: EmbeddedShell): EmbedResult {
  const existing = findEmbedded(show, shell);
  if (existing) return { ok: true, show, key: existing };
  if (Object.keys(show.shells).length >= MAX_SHOW_SHELLS) return { ok: false, reason: 'shell-cap' };
  const key = freeShellKey(show);
  return { ok: true, show: { ...show, shells: { ...show.shells, [key]: shell } }, key };
}

/** Whether adding a cue with `shell` would be blocked by the shell cap. */
export function wouldHitShellCap(show: ShowDocument, shell: EmbeddedShell): boolean {
  return findEmbedded(show, shell) === null && Object.keys(show.shells).length >= MAX_SHOW_SHELLS;
}

export function atCueCap(show: ShowDocument): boolean {
  return show.cues.length >= MAX_SHOW_CUES;
}

/** Appends a cue (no `burstHeight` key). The caller has checked the caps. */
export function withCue(show: ShowDocument, cue: ShowCue): ShowDocument {
  return { ...show, cues: [...show.cues, cue] };
}

/** Replaces one cue's fields; `burstHeight: undefined` removes the key (never `null`). */
export function updateCue(
  show: ShowDocument,
  id: string,
  patch: Partial<Omit<ShowCue, 'id'>>,
): ShowDocument {
  return {
    ...show,
    cues: show.cues.map((c) => {
      if (c.id !== id) return c;
      const next: ShowCue = { ...c, ...patch };
      if ('burstHeight' in patch && patch.burstHeight === undefined) delete next.burstHeight;
      next.t = clamp(next.t, 0, show.duration);
      next.x = clamp(next.x, 0, 1);
      return next;
    }),
  };
}

export function deleteCue(show: ShowDocument, id: string): ShowDocument {
  return { ...show, cues: show.cues.filter((c) => c.id !== id) };
}

/** Deletes `key` and every cue that uses it (phase-6.md §4.3). */
export function removeShell(show: ShowDocument, key: string): ShowDocument {
  const shells = { ...show.shells };
  delete shells[key];
  return { ...show, shells, cues: show.cues.filter((c) => c.shell !== key) };
}

export function cuesUsing(show: ShowDocument, key: string): number {
  return show.cues.reduce((n, c) => n + (c.shell === key ? 1 : 0), 0);
}

/** The cues in firing order `(fireStep, id)`. */
export function firingOrder(show: Pick<ShowDocument, 'cues'>): ShowCue[] {
  return orderCues(show.cues);
}

/** The latest launch time, or 0. */
export function lastLaunch(show: Pick<ShowDocument, 'cues'>): number {
  return show.cues.reduce((m, c) => Math.max(m, c.t), 0);
}

/** The lowest duration allowed now: max(1, last cue t) (phase-6.md §9.3). */
export function minDuration(show: Pick<ShowDocument, 'cues'>): number {
  return Math.max(SHOW_LIMITS.duration.min, lastLaunch(show));
}

/** Whether the shell is a cue's own (an own key; never `in`). */
export function hasShell(show: ShowDocument, key: string): boolean {
  return Object.hasOwn(show.shells, key) && KEY_PATTERN.test(key);
}

/** A shell document with a sky, so it can be fired or listed (the show's sky wins in a show). */
export function asShell(shell: EmbeddedShell): ShellDocument {
  return { ...shell };
}

/** Option labels for the Shell select: duplicate names get ` · 2`, ` · 3` in key order. */
export function shellOptionLabels(show: ShowDocument): { key: string; label: string }[] {
  const seen = new Map<string, number>();
  return Object.keys(show.shells).map((key) => {
    const name = embeddedShell(show, key)?.name ?? '';
    const n = (seen.get(name) ?? 0) + 1;
    seen.set(name, n);
    return { key, label: n === 1 ? name : `${name} · ${n}` };
  });
}
