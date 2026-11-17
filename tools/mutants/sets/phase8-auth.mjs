// Phase 8 B1 security mutants (Bowser; record bowser-phase8-server-auth.md): the CSRF guard, the
// fail-closed fallback policy, the return-URL validator and the provider allowlist. Plain dotnet
// test (no Postgres), filtered to the suites that should kill each one. Expected: every mutant
// KILLED. Not here, as equivalent (recorded): DefaultChallengeScheme = Google (the policy names
// the cookie scheme, so it never decides the challenge); SafeReturnUrl's raw second-char check (the decoded
// check covers it) and the failure redirect's re-check (its input was checked at login and travels
// inside DataProtection-protected state). R1 is the one multi-file, Postgres-only mutant (below).
const AUTH = 'FullyQualifiedName~Fireworks.Api.Tests.Auth|FullyQualifiedName~CreationWriteGate|FullyQualifiedName~FormBodyGate';
export default {
  kind: 'api',
  description: 'Phase 8 B1: CSRF guard, fallback policy, SafeReturnUrl, provider allowlist',
  mutants: [
    { id: 'G1', name: 'guard allows same-site', file: 'Services/Identity/CrossOriginWriteGuard.cs',
      old: 'string.Equals(fetchSite[0], "same-origin", StringComparison.Ordinal)', new: 'fetchSite[0] is "same-origin" or "same-site"', filter: AUTH },
    { id: 'G2', name: 'guard ignores Origin', file: 'Services/Identity/CrossOriginWriteGuard.cs',
      old: '            return origin.Count == 1\n', new: '            return origin.Count >= 0 || true\n', filter: AUTH },
    { id: 'G3', name: 'guard unregistered', file: 'Services/Identity/IdentityRegistration.cs',
      old: '        app.UseCrossOriginWriteGuard();', new: '        // (guard removed)', filter: AUTH },
    { id: 'G4', name: 'guard only on /api', file: 'Services/Identity/CrossOriginWriteGuard.cs',
      old: '        if (HttpMethods.IsGet(request.Method) || HttpMethods.IsHead(request.Method)', new: '        if (!request.Path.StartsWithSegments("/api") || HttpMethods.IsGet(request.Method) || HttpMethods.IsHead(request.Method)', filter: AUTH },
    { id: 'G5', name: 'Sec-Fetch-Site ignored unless repeated', file: 'Services/Identity/CrossOriginWriteGuard.cs',
      old: '        if (fetchSite.Count > 0)', new: '        if (fetchSite.Count > 1)', filter: AUTH },
    { id: 'F1', name: 'fallback policy drops the id assertion', file: 'Services/Identity/IdentityRegistration.cs',
      old: '.RequireAssertion(context => FireworksClaims.TryGetUserId(context.User, out _))', new: '.RequireAssertion(context => true)', filter: AUTH },
    { id: 'F2', name: 'no fallback policy (default policy instead)', file: 'Services/Identity/IdentityRegistration.cs',
      old: '            .SetFallbackPolicy(new AuthorizationPolicyBuilder(CookieScheme)', new: '            .SetDefaultPolicy(new AuthorizationPolicyBuilder(CookieScheme)', filter: AUTH },
    { id: 'F3', name: '[AllowAnonymous] on PUT', file: 'Controllers/CreationsController.cs',
      old: '    [HttpPut(ItemRoute)]', new: '    [HttpPut(ItemRoute)]\n    [AllowAnonymous]', filter: AUTH },
    // F4: the policy names its scheme, so DefaultChallengeScheme alone is equivalent (measured: it
    // survived); the mutant that matters is the policy challenging Google.
    { id: 'F4', name: 'fallback policy challenges Google', file: 'Services/Identity/IdentityRegistration.cs',
      old: '            .SetFallbackPolicy(new AuthorizationPolicyBuilder(CookieScheme)', new: '            .SetFallbackPolicy(new AuthorizationPolicyBuilder(GoogleProviderSettings.Scheme)', filter: AUTH },
    { id: 'F5', name: 'unparseable id Forbid stays 403', file: 'Services/Identity/IdentityRegistration.cs',
      old: '                        : StatusCodes.Status401Unauthorized;', new: '                        : StatusCodes.Status403Forbidden;', filter: AUTH },
    { id: 'R2', name: 'returnUrl: no decoded second-char check', file: 'Services/Identity/SafeReturnUrl.cs',
      old: ' || (decoded.Length > 1 && decoded[1] is \'/\' or \'\\\\\'))', new: ' || false)', filter: AUTH },
    { id: 'R3', name: 'returnUrl: control chars allowed', file: 'Services/Identity/SafeReturnUrl.cs',
      old: "if (c < '\\u0020' || c == '\\u007f' || c == '\\\\')", new: "if (c == '\\\\')", filter: AUTH },
    { id: 'R4', name: 'returnUrl: /api allowed', file: 'Services/Identity/SafeReturnUrl.cs',
      old: 'if (IsApiPath(path) || IsApiPath(decoded) ||', new: 'if (false ||', filter: AUTH },
    { id: 'R5', name: 'returnUrl: /api check case-sensitive', file: 'Services/Identity/SafeReturnUrl.cs',
      old: 'path.StartsWith("/api", StringComparison.OrdinalIgnoreCase)', new: 'path.StartsWith("/api", StringComparison.Ordinal)', filter: AUTH },
    { id: 'R6', name: 'returnUrl: length limit doubled', file: 'Services/Identity/SafeReturnUrl.cs',
      old: 'raw.Length > MaxLength ||', new: 'raw.Length > MaxLength * 2 ||', filter: AUTH },
    { id: 'R7', name: 'returnUrl: no encoded-path decode', file: 'Services/Identity/SafeReturnUrl.cs',
      old: '            decoded = Uri.UnescapeDataString(path);', new: '            decoded = path;', filter: AUTH },
    { id: 'R8', name: 'login skips SafeReturnUrl (IsLocalUrl only)', file: 'Controllers/AuthController.cs',
      old: '        var returnUrl = SafeReturnUrl.From(raw);', new: '        var returnUrl = raw ?? SafeReturnUrl.Home;', filter: AUTH },
    { id: 'P1', name: 'provider match ignores case', file: 'Controllers/AuthController.cs',
      old: 'string.Equals(p.Id, provider, StringComparison.Ordinal)', new: 'string.Equals(p.Id, provider, StringComparison.OrdinalIgnoreCase)', filter: AUTH },
    { id: 'P2', name: 'no allowlist: challenge whatever was asked', file: 'Controllers/AuthController.cs',
      old: 'var match = authSetup.LoginProviders.FirstOrDefault(p => string.Equals(p.Id, provider, StringComparison.Ordinal));',
      new: 'var match = authSetup.LoginProviders.FirstOrDefault() is { } first ? first with { Scheme = provider } : null;', filter: AUTH },
    // R1: the read-then-write If-Match that IfMatchRacePostgresTests is measured against (Boo
    // F4/ruling 6; killed in round 1 of 25 on real Postgres, boo-phase8-security-verification.md).
    // Two files: the C# pre-check replaces the token's original value, and the token itself goes,
    // so the UPDATE's WHERE no longer carries updated_at. `postgres: true`: it only means anything
    // against real Postgres (the race test is skipped on SQLite), so the runner runs it only when
    // opted in and reports SKIPPED otherwise, never KILLED or SURVIVED (Toad wires the flag).
    { id: 'R1', name: 'read-then-write If-Match (no concurrency token, C# pre-check)', postgres: true,
      swaps: [
        { file: 'Repositories/CreationRepository.cs',
          old: '        entry.Property(c => c.UpdatedAt).OriginalValue = expectedUpdatedAt;',
          new: '        if (creation.UpdatedAt != expectedUpdatedAt) { dbContext.Entry(creation).State = EntityState.Detached; return new UpdateOutcome(null, creation.UpdatedAt); }' },
        { file: 'Data/FireworksDbContext.cs',
          // The comment line anchors it: the bare untokened line already exists (line ~52).
          old: "only shapes the UPDATE's WHERE clause.\n            entity.Property(e => e.UpdatedAt).HasColumnName(\"updated_at\").IsConcurrencyToken();",
          new: "only shapes the UPDATE's WHERE clause.\n            entity.Property(e => e.UpdatedAt).HasColumnName(\"updated_at\");" },
      ],
      filter: 'FullyQualifiedName~IfMatchRacePostgresTests' },
  ],
};
