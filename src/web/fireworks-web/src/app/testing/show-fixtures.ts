import { openShow } from '../../engine/model/open';
import type { ShowDocument } from '../../engine/model/show';

interface NodeFs {
  readFileSync(path: string, encoding: 'utf8'): string;
}
declare const process: { cwd(): string; getBuiltinModule(id: 'node:fs'): NodeFs };

/** Toad's shared fixture (acceptance 6b.1), read from the repo root (cwd is the workspace). */
export const DONE_WHEN_FIXTURE = 'schema/fixtures/valid/show/done-when-60s-50.json';

let doneWhenCache: string | null = null;

/**
 * The Phase 6 Done-when show from Toad's shared fixture `schema/fixtures/valid/show/
 * done-when-60s-50.json`: 60 s, 50 cues, a cue at t = 0 and at t = duration, two same-step pairs
 * whose array order is the reverse of ordinal id order (c2/c10, c3/c20), x at 0 and 1, cues with
 * and without `burstHeight`, non-zero wind, crossette, crackle, glitter, strobe and a 4-break
 * shell, plus one unused shell. Opened through `openShow` like any document; a fresh copy each
 * call, so a spec may mutate it.
 */
export function doneWhenShow(): ShowDocument {
  doneWhenCache ??= process
    .getBuiltinModule('node:fs')
    .readFileSync(`${process.cwd()}/../../../${DONE_WHEN_FIXTURE}`, 'utf8');
  const opened = openShow((JSON.parse(doneWhenCache) as { document: unknown }).document);
  if (!opened.ok) throw new Error(`${DONE_WHEN_FIXTURE} is not a valid show`);
  return opened.show;
}
