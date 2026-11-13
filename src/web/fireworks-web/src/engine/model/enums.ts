/**
 * Break enums (prototypes/fireworks-prototype.html, `PATTERNS`, `TRAILS`, `EFFECTS`). The index of
 * a trail or effect in its array is the numeric code the simulation stores per particle
 * (`sim/kinds.ts`), so the order is part of the engine contract.
 */
export const PATTERNS = ['peony', 'ring', 'palm', 'heart'] as const;
export const TRAILS = ['none', 'tail', 'glitter'] as const;
export const EFFECTS = ['none', 'crackle', 'crossette', 'strobe'] as const;

export type Pattern = (typeof PATTERNS)[number];
export type Trail = (typeof TRAILS)[number];
export type Effect = (typeof EFFECTS)[number];

/** Playback modes of the stage. `show` (random auto-show) is a viewer mode and is never saved. */
export const PLAYBACK_MODES = ['loop', 'manual', 'show'] as const;
export type PlaybackMode = (typeof PLAYBACK_MODES)[number];
