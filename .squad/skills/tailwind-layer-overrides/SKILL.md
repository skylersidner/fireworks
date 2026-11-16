# Skill: Media-query overrides against Tailwind utilities

**Domain:** Tailwind 4 `styles.css` rules that must override utility classes in templates (touch sizes, forced font sizes).
**Confidence:** high. Phase 7 B3: the touch check in Chromium found `min-w-0` and `text-caption` beating a `@media (pointer: coarse)` block inside `@layer components`.

## Rules
- Cascade layers order `base < components < utilities`, and **unlayered CSS beats every layer**, whatever the specificity. A component-layer override loses to any utility on the same element.
- Put "must win" overrides (`@media (pointer: coarse)` targets, 16 px field text) **outside every `@layer`**. Pin that with a brace-depth spec (`button-styles.spec.ts`) and a negative control that wraps the block in a layer.
- jsdom can't check this, because it doesn't run Tailwind. The evidence is computed style in a real browser (`scratchpad/pw/luigi-touch.mjs`: every visible `.btn` min-height/min-width ≥ 44 with `touch-action: manipulation`, fields min-height 44 and `font-size: 16px`).
- Don't fix it with `!important` utilities in templates. One block in `styles.css` keeps desktop unchanged and stays easy to review.

- **The rem base is 13px here (Phase 7 C4).** `html, body { font: 13px/1.4 }` makes every spacing utility 0.8125× its nominal px (`gap-2` = 6.5px, `min-h-11` = 35.75px). Any rule that promises a pixel size (44px targets, 8px gaps) must use raw px (`min-h-[44px]`, `gap-[8px]`, or a px class like `.touch-row`), and a computed-size browser check is the only evidence.
- **Pseudo-element overrides need a real-browser readout through CDP.** In Chromium, `getComputedStyle(el, '::-webkit-slider-thumb')` returns the host element's box. Read the UA shadow tree (`DOM.getDocument({ pierce: true })`, `CSS.getComputedStyleForNode`). The track has `pseudo=`, and the thumb is `id="thumb"` inside it.
