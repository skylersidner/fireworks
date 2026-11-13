/**
 * Numeric codes the particle store keeps per particle (prototypes/fireworks-prototype.html,
 * `K_*`, `T_*`, `E_*`). Trail and effect codes equal the index of the name in `TRAILS` and
 * `EFFECTS` (model/enums.ts); `burst()` maps names to codes with `indexOf`.
 */
export const K_STAR = 0;
export const K_EMBER = 1;
export const K_GLITTER = 2;
export const K_POP = 3;
export const K_FLASH = 4;
export const K_HEAD = 5;
export const KIND_COUNT = 6;

/** Kind names in code order, for stats and test output. */
export const KIND_NAMES = ['star', 'ember', 'glitter', 'pop', 'flash', 'head'] as const;
export type KindName = (typeof KIND_NAMES)[number];

export const T_NONE = 0;
export const T_TAIL = 1;
export const T_GLITTER = 2;

export const E_NONE = 0;
export const E_CRACKLE = 1;
export const E_CROSSETTE = 2;
export const E_STROBE = 3;
