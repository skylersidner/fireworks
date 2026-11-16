// Phase 7 C3 API mutants (Toad; record toad-phase7-c3-review.md). Moved from scratchpad
// toad-c3/apimut.py (A1-A10, Hardening tests) and apimut2.py (B1-B4, the 500 ledger row in
// ApiCacheControlLedgerTests). Plain dotnet test (no Postgres). Expected: every mutant KILLED.
export default {
  kind: 'api',
  description: 'Phase 7 C3: ETag/304, cache-control, site headers, health checks, the 500 ledger row',
  mutants: [
  {
    "id": "A1",
    "name": "GET sends no ETag header",
    "file": "Controllers/CreationsController.cs",
    "old": "var etag = Tag(result.Value!);",
    "new": "var etag = EntityTagFor(result.Value!.UpdatedAt, jsonOptions.Value.JsonSerializerOptions);",
    "filter": "FullyQualifiedName~Hardening"
  },
  {
    "id": "A2",
    "name": "new relaxed writer on ListMine",
    "file": "Controllers/CreationsController.cs",
    "old": "var result = await creationService.ListMineAsync(query, cancellationToken);",
    "new": "var result = await creationService.ListMineAsync(query, cancellationToken); Response.Headers.CacheControl = ShareCodeGetCacheControl;",
    "filter": "FullyQualifiedName~Hardening"
  },
  {
    "id": "A3",
    "name": "404 share GET relaxed",
    "file": "Controllers/CreationsController.cs",
    "old": "        var result = await creationService.GetAsync(shareCode, cancellationToken);",
    "new": "        Response.Headers.CacheControl = ShareCodeGetCacheControl;\n        var result = await creationService.GetAsync(shareCode, cancellationToken);",
    "filter": "FullyQualifiedName~Hardening"
  },
  {
    "id": "A4",
    "name": "garbage If-None-Match matches",
    "file": "Controllers/CreationsController.cs",
    "old": "candidate.Compare(etag, useStrongComparison: false));",
    "new": "candidate.Compare(etag, useStrongComparison: false) || candidate.Tag.Length > 2);",
    "filter": "FullyQualifiedName~Hardening"
  },
  {
    "id": "A5",
    "name": "CSP worker-src drift",
    "file": "Services/ResponseHeaders.cs",
    "old": "\"worker-src 'none'; base-uri 'self'",
    "new": "\"worker-src 'self'; base-uri 'self'",
    "filter": "FullyQualifiedName~Hardening"
  },
  {
    "id": "A6",
    "name": "site-wide headers not overwriting",
    "file": "Services/ResponseHeaders.cs",
    "old": "headers[name] = value;",
    "new": "headers.TryAdd(name, value);",
    "filter": "FullyQualifiedName~Hardening"
  },
  {
    "id": "A7",
    "name": "headers applied after next",
    "file": "Services/ResponseHeaders.cs",
    "old": "            context.Response.OnStarting(() =>\n            {\n                Apply(context, sendHsts, contentSecurityPolicy);\n                return Task.CompletedTask;\n            });\n\n            await next();",
    "new": "            await next();\n            if (!context.Response.HasStarted) Apply(context, sendHsts, contentSecurityPolicy);",
    "filter": "FullyQualifiedName~Hardening"
  },
  {
    "id": "A8",
    "name": "ready failure is Degraded (200)",
    "file": "Services/Health/HealthEndpoints.cs",
    "old": "HealthStatus.Unhealthy, [ReadyTag]",
    "new": "HealthStatus.Degraded, [ReadyTag]",
    "filter": "FullyQualifiedName~Hardening"
  },
  {
    "id": "A9",
    "name": "probe exception reads healthy",
    "file": "Services/Health/HealthEndpoints.cs",
    "old": "                return false;\n            }\n        }, CancellationToken.None);",
    "new": "                return true;\n            }\n        }, CancellationToken.None);",
    "filter": "FullyQualifiedName~Hardening"
  },
  {
    "id": "A10",
    "name": "ready has no timeout",
    "file": "Services/Health/HealthEndpoints.cs",
    "old": "[ReadyTag], ReadyTimeout);",
    "new": "[ReadyTag]);",
    "filter": "FullyQualifiedName~Hardening"
  },
  {
    "id": "B1",
    "name": "no normalization (handler's no-cache,no-store kept)",
    "file": "Services/ResponseHeaders.cs",
    "old": "if (context.Features.Get<IExceptionHandlerFeature>() is not null)",
    "new": "if (false && context.Features.Get<IExceptionHandlerFeature>() is not null)",
    "filter": "FullyQualifiedName~ApiCacheControlLedgerTests"
  },
  {
    "id": "B2",
    "name": "value changed to no-cache",
    "file": "Services/ResponseHeaders.cs",
    "old": "            headers.CacheControl = DefaultCacheControl;\n            headers.Remove(\"Pragma\");\n            headers.Remove(\"Expires\");\n        }\n        else if",
    "new": "            headers.CacheControl = \"no-cache\";\n            headers.Remove(\"Pragma\");\n            headers.Remove(\"Expires\");\n        }\n        else if",
    "filter": "FullyQualifiedName~ApiCacheControlLedgerTests"
  },
  {
    "id": "B3",
    "name": "Pragma kept",
    "file": "Services/ResponseHeaders.cs",
    "old": "            headers.Remove(\"Pragma\");\n",
    "new": "",
    "filter": "FullyQualifiedName~ApiCacheControlLedgerTests"
  },
  {
    "id": "B4",
    "name": "Expires kept",
    "file": "Services/ResponseHeaders.cs",
    "old": "            headers.Remove(\"Expires\");\n",
    "new": "",
    "filter": "FullyQualifiedName~ApiCacheControlLedgerTests"
  }
],
};
