# Browser CSRF gate (Chromium)

Use this when a gate plays an attacker origin against the app, for example the CSRF guard or cookie SameSite behaviour. Reference implementation: `tools/browser-gates/gate-auth.mjs` (csrf part).

1. **Serve the attacker page from a real loopback HTTP server** (`http.createServer` on 127.0.0.1, a free port), not `route.fulfill`. Chrome's Local Network Access treats a fulfilled page as public and blocks its requests to 127.0.0.1 before they leave the browser. A broken guard then looks "blocked". Assert that no request failed with `LocalNetworkAccess`.
2. **Same-site versus cross-site on loopback:** `127.0.0.1:<other port>` is same-site and cross-origin with `127.0.0.1:<app port>`, because ports don't make a site. `localhost:<port>` is cross-site.
3. **Observe over CDP** (`ctx.newCDPSession(page)`, `Network.enable`): `requestWillBeSentExtraInfo` carries `Sec-Fetch-Site`, `responseReceivedExtraInfo` carries the server status of CORP- or CORS-blocked responses, and `loadingFailed` carries the block reason. Playwright's `allHeaders()` omits `Sec-Fetch-*`.
4. **Assert the effect as well as the status:** the session survives (`api/me`), the list is byte-identical, and the row is still there.
5. **Negative control:** replay the same requests from a real app document (same-origin). The guard lets them through, so the detectors must report the landed attack. Note that `form-action 'self'` allows that form.
