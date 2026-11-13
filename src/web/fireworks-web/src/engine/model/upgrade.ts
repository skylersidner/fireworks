import type { ShellIssue } from './normalize';
import { SHELL_VERSION } from './shell';
import { SHOW_VERSION } from './show';

/**
 * Client-side upgrades (docs/fireworks-app/schema.md §8.2). Always parse → upgrade → normalize to
 * play or edit, and validate before saving. The server never upgrades.
 */
export type UpgradeResult =
  | { readonly ok: true; readonly document: unknown; readonly from: number }
  | { readonly ok: false; readonly error: ShellIssue }; // code 'version', path 'version'

/** One step `vN → vN+1`, on raw parsed JSON. Must not fail on fields it doesn't touch. */
export type UpgradeStep = (document: Record<string, unknown>) => Record<string, unknown>;

/**
 * Steps keyed by their from-version. Never delete one. Each new step comes with fixture pairs
 * under `schema/fixtures/upgrade/<kind>/vN-to-vN+1/`. Empty in v1.
 */
export const SHELL_UPGRADES: Readonly<Record<number, UpgradeStep>> = Object.freeze({});
export const SHOW_UPGRADES: Readonly<Record<number, UpgradeStep>> = Object.freeze({});

export function upgradeShell(raw: unknown): UpgradeResult {
  return upgrade(raw, SHELL_VERSION, SHELL_UPGRADES);
}

export function upgradeShow(raw: unknown): UpgradeResult {
  return upgrade(raw, SHOW_VERSION, SHOW_UPGRADES);
}

function upgrade(
  raw: unknown,
  current: number,
  steps: Readonly<Record<number, UpgradeStep>>,
): UpgradeResult {
  // Not an object: nothing to upgrade; normalize reports `not-object`.
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: true, document: raw, from: current };
  }
  let doc = raw as Record<string, unknown>;
  const version = doc['version'];
  if (version === undefined || version === null) {
    // While v1 is current, a missing version is left for normalize to report (`missing`). Once v2
    // exists, a missing version means v1 and the v1→v2 step sets it.
    if (current === 1) return { ok: true, document: raw, from: current };
    doc = { ...doc, version: 1 };
  }
  const from = (doc['version'] as unknown) ?? 1;
  if (typeof from !== 'number' || !Number.isInteger(from) || from < 1 || from > current) {
    return {
      ok: false,
      error: {
        path: 'version',
        code: 'version',
        message:
          typeof from === 'number' && from > current
            ? `version: ${from} is newer than this app supports (${current}); reload to open it.`
            : `version: unsupported version ${JSON.stringify(from)} (expected ${current}).`,
        value: from,
      },
    };
  }
  for (let v = from; v < current; v++) {
    const step = steps[v];
    if (!step) throw new Error(`upgrade: no step from version ${v}`);
    doc = step(doc);
  }
  return { ok: true, document: doc, from };
}
