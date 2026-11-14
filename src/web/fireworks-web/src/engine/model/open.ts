import {
  normalizeShell,
  normalizeShow,
  type NormalizeResult,
  type ShowNormalizeResult,
} from './normalize';
import { upgradeShell, upgradeShow } from './upgrade';

/**
 * Every client entry for an untrusted document, in the one order schema.md §8.3 allows:
 * parse (the caller's) → upgrade → normalize (lenient). The player, `/c/:code`, JSON Apply and
 * draft restore all come through here, so none of them can skip the upgrade.
 *
 * An upgrade failure (a version newer than this bundle, or not an integer) is returned as the
 * normalize failure branch with that one `version` issue, so callers handle one result shape.
 */
export function openShell(raw: unknown): NormalizeResult {
  const upgraded = upgradeShell(raw);
  if (!upgraded.ok) return { ok: false, errors: [upgraded.error], adjustments: [] };
  return normalizeShell(upgraded.document);
}

/** `openShell` for a ShowDocument (Phase 6 and the `/s/:code` player for shows). */
export function openShow(raw: unknown): ShowNormalizeResult {
  const upgraded = upgradeShow(raw);
  if (!upgraded.ok) return { ok: false, errors: [upgraded.error], adjustments: [] };
  return normalizeShow(upgraded.document);
}
