---
name: import-boundary-spec
description: How to write (or review) a source-walking spec that enforces module boundaries, so it can't be bypassed by relative paths, barrels, or odd import syntax.
---

# Import-boundary specs that can't be walked around

Origin: Phase 2a review of `src/web/fireworks-web/src/engine/engine-boundary.spec.ts` (record `yoshi-phase2a-engine-boundaries.md`).

## Checklist
1. **Check package names and layer edges.** "Layer X imports no `pkg`" is bypassed by X importing a sibling layer that does. Resolve relative specifiers to files and assert the allowed directed edges (for example, model, then sim, then loop/render, never back).
2. **Check transitive reach for the heavy package.** "Only `render/` imports pixi" still lets `app/` import a render file statically and pull Pixi into the main chunk. Walk static value imports from every file outside the owner directory. A dynamic `import()` is the legal lazy edge, and a type-only import of a package-free file is fine.
3. **Parse every form, and fail on what you can't parse.** Static, `import type`, side-effect, `export ... from`, `export * from`, `import x = require()`, `typeof import('x')`, `` import(`x`) ``, `import('x', { with })`. A non-literal `import(expr)` in a guarded layer is an offense, not a skip.
4. **Strip comments carefully.** A line-comment regex eats the rest of the line after a `'a//b'` string. Prefer the TypeScript scanner (`ts.preProcessFile` gives `importedFiles` and handles strings and comments) when `typescript` is already a dev dependency.
5. **Have a sanity test and parser controls.** The walker must see files in every layer, and the parser must find the real import where it lives. Build forbidden literals from parts, so the spec file doesn't trip itself.
6. **No allow-list.** If something legitimately needs an exception, move the file instead.

## Quick probe
Copy the spec's parser into a scratch `.mjs` and feed it the forms in item 3. Any empty result is a bypass.
