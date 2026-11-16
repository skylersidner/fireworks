// Phase 6 post-gate ClientPlayback config mutants (Toad; API 10 of 10 killed at the time). Moved
// from scratchpad toad-p6cfg-api/bmut.py. Runs the whole plain dotnet test suite (filter '').
// The web half of this contract (client-config.contract.spec.ts) is not run here.
export default {
  kind: 'api',
  description: 'Phase 6 post-gate: ClientPlayback registration, ranges, defaults, rate limit',
  mutants: [
  {
    "id": "no-eager",
    "name": "no-eager",
    "file": "Services/ClientConfig/ClientConfigRegistration.cs",
    "old": "if (result.Failed)\n",
    "new": "if (result.Failed && false)\n",
    "filter": ""
  },
  {
    "id": "no-bind",
    "name": "no-bind",
    "file": "Services/ClientConfig/ClientConfigRegistration.cs",
    "old": "            .Bind(section)\n",
    "new": "",
    "filter": ""
  },
  {
    "id": "swap-seek-delay",
    "name": "swap-seek-delay",
    "file": "Controllers/ClientConfigController.cs",
    "old": "playback.SeekBudgetMs,\n            playback.CatchingUpDelayMs,",
    "new": "playback.CatchingUpDelayMs,\n            playback.SeekBudgetMs,",
    "filter": ""
  },
  {
    "id": "range-lo-3",
    "name": "range-lo-3",
    "file": "Services/ClientConfig/ClientPlaybackOptions.cs",
    "old": "[Range(4, 100,",
    "new": "[Range(3, 100,",
    "filter": ""
  },
  {
    "id": "range-hi-5001",
    "name": "range-hi-5001",
    "file": "Services/ClientConfig/ClientPlaybackOptions.cs",
    "old": "[Range(0, 5000,",
    "new": "[Range(0, 5001,",
    "filter": ""
  },
  {
    "id": "no-ratelimit",
    "name": "no-ratelimit",
    "file": "Controllers/ClientConfigController.cs",
    "old": "    [EnableRateLimiting(FireworksRateLimiting.ReadPolicy)]\n",
    "new": "",
    "filter": ""
  },
  {
    "id": "appsettings-30",
    "name": "appsettings-30",
    "file": "appsettings.json",
    "old": "\"SeekBudgetMs\": 25,",
    "new": "\"SeekBudgetMs\": 30,",
    "filter": ""
  },
  {
    "id": "class-default-30",
    "name": "class-default-30",
    "file": "Services/ClientConfig/ClientPlaybackOptions.cs",
    "old": "public int SeekBudgetMs { get; init; } = 25;",
    "new": "public int SeekBudgetMs { get; init; } = 30;",
    "filter": ""
  }
],
};
