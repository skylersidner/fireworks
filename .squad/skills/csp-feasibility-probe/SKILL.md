# Skill: Probe a CSP before anyone implements it

**Domain:** Security review (CSP, headers)
**Applies to:** deciding CSP directives for the Angular + Pixi bundle, and verifying them afterward
**Confidence:** medium (Boo, Phase 7 A1, 2026-11-15)

## Why
- Static greps lie. Pixi's `new Function` text stays in the chunks even when `pixi.js/unsafe-eval` makes it unreachable, and Pixi's `unsafeEvalSupported()` probe fires a violation even though it catches the error. Only the runtime `securitypolicyviolation` event is evidence.
- Header changes are Bowser's code, and the bundle is Luigi's. A route-injected header lets a reviewer measure a policy without touching either.

## Steps
1. Clean-publish the API to the scratchpad (skill `probe-the-published-build`) and run it with `--webroot <dir>`.
2. For bundle changes, rsync `src/web/fireworks-web` minus `node_modules`, `.angular` and `dist` into the scratchpad, symlink `node_modules`, edit the copy, and run `npx ng build --output-path <scratch>`. The served root is `<scratch>/browser`.
3. In Playwright, `addInitScript` pushes every `securitypolicyviolation` (`effectiveDirective`, `blockedURI`, `sourceFile:line`) onto `window.__v`. `page.route('**/*')` does `route.fetch()` and fulfills with an added `content-security-policy` header. Capture console errors and warnings and `pageerror`.
4. Visit every surface: `/` (auto-play), `/show`, `/c/<show>`, `/s/<shell>`, `/s/<show>`, `/mine` with writes on, `/status`, and the not-found pages. Wait about 4 s each, then record violations and the canvas count.
5. Run the current build first (the expected violations are the negative control), then the fixed build.
6. After implementation, repeat with the real header from the image, with no route injection, in all three engines. Install `firefox` and `webkit` for the Playwright version in use.

## Traps
- `curl -X HEAD` waits for a body and hangs. Use `curl -I`.
- Chrome's own error page for an empty-body 404 makes `page.goto` throw `ERR_HTTP_RESPONSE_CODE_FAILURE`. Catch it per path.
- Fixtures under `schema/fixtures/valid` wrap `{description, kind, document}`. POST only `{kind, document}`.
