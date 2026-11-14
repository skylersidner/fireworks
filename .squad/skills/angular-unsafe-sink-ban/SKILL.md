# Skill: Ban HTML and code sinks in an Angular app, and prove the ban works

**Domain:** XSS structure specs (Phase 5 C1/C2; Phase 6 and later, for any new surface that renders creation text)
**Confidence:** medium. Measured once, on 2026-11-14 (Boo, Phase 5 verification).

## Spellings a case-sensitive grep misses
- `[innerHtml]="x"`: Angular's compiler remaps `innerHtml` to the DOM property `innerHTML` (`DOM_PROPERTY_REMAPPING` in `@angular/compiler`, along with `class`, `for`, `formaction`, `readonly` and `tabindex`). Match it case-insensitively: `/inner\s*html|outer\s*html/i`.
- `href="{{ name }}"`: interpolation in an attribute is a property binding. A regex for `[href]="…"` won't match it.
- Also consider `[attr.href]`, `[attr.xlink:href]`, `[formAction]`, `[srcdoc]`, `Range.createContextualFragment`, `DOMParser`, `setHTMLUnsafe`, and Pixi `Text` or `BitmapText` of user text.

## How to verify the verifier
A string-literal negative control (`UNSAFE_SINK.test('<span [innerHTML]=…>')`) proves only the regex. To prove the file walk too, append the bad line to a real template (for example `player-page.html`), run `npx ng test --watch=false --include src/app/unsafe-sinks.spec.ts`, and expect a failure. Restore from a scratchpad copy, using `trap` on exit, and `cmp` the file afterwards. Try every alternate spelling above, not only the one the spec names.

## Bidi in names
§6.4 removes Cc characters but keeps Cf characters (U+202E). Use `<bdi>` where a name stands next to controls. In plain strings (toasts, dialogs, `document.title`), wrap the name in U+2068 … U+2069. Reordering can't cross element boundaries, so a button with fixed text in its own element can't be relabeled.
