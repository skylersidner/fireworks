// Phase 7 C3 web mutants (Toad; record toad-phase7-c3-review.md). Moved from scratchpad
// toad-c3/mut.py. Targets: TimelineDriver D1 prefix cap and checkpoint adoption, warm-up shadow
// sync (M10, W9), Show JSON (J1, J2) and the embedded-shell read guard (F1-F3).
// Expected: every mutant KILLED. W3, W6, W8 and J1 had timeouts among their failures at load 15-33,
// which is why the runner never counts a timeout as a kill.
export default {
  kind: 'web',
  description: 'Phase 7 C3: timeline driver, warm-up shadow, Show JSON, embedded-shell reads',
  mutants: [
  {
    "id": "W1",
    "name": "D1 no prefix cap",
    "file": "src/engine/loop/timeline-driver.ts",
    "old": "return i === b.length && i < a.length ? Math.min(d, b.at(-1)?.fireStep ?? 0) : d;",
    "new": "return d;",
    "specs": [
      "src/engine/loop/timeline-driver.spec.ts",
      "src/app/shared/fireworks-stage/fireworks-stage.phase7.spec.ts",
      "src/app/features/show/pages/show-builder-page/show-builder.store.spec.ts"
    ]
  },
  {
    "id": "W2",
    "name": "D1 empty receiver keeps all",
    "file": "src/engine/loop/timeline-driver.ts",
    "old": "b.at(-1)?.fireStep ?? 0) : d;",
    "new": "b.at(-1)?.fireStep ?? Infinity) : d;",
    "specs": [
      "src/engine/loop/timeline-driver.spec.ts",
      "src/app/shared/fireworks-stage/fireworks-stage.phase7.spec.ts",
      "src/app/features/show/pages/show-builder-page/show-builder.store.spec.ts"
    ]
  },
  {
    "id": "W3",
    "name": "restore trusts old endStep",
    "file": "src/engine/loop/timeline-driver.ts",
    "old": "this._endStep = cp.next === this.schedule.length ? cp.endStep : null;",
    "new": "this._endStep = cp.endStep;",
    "specs": [
      "src/engine/loop/timeline-driver.spec.ts",
      "src/app/shared/fireworks-stage/fireworks-stage.phase7.spec.ts",
      "src/app/features/show/pages/show-builder-page/show-builder.store.spec.ts"
    ]
  },
  {
    "id": "W4",
    "name": "adopt one interval past divergence",
    "file": "src/engine/loop/timeline-driver.ts",
    "old": "(c) => c.step <= diverge && !held.has(c.step)",
    "new": "(c) => c.step <= diverge + 1200 && !held.has(c.step)",
    "specs": [
      "src/engine/loop/timeline-driver.spec.ts",
      "src/app/shared/fireworks-stage/fireworks-stage.phase7.spec.ts",
      "src/app/features/show/pages/show-builder-page/show-builder.store.spec.ts"
    ]
  },
  {
    "id": "W5",
    "name": "M9 compatible ignores digest",
    "file": "src/engine/loop/timeline-driver.ts",
    "old": "from.digestOn === this.digestOn &&",
    "new": "/* M9 */",
    "specs": [
      "src/engine/loop/timeline-driver.spec.ts",
      "src/app/shared/fireworks-stage/fireworks-stage.phase7.spec.ts",
      "src/app/features/show/pages/show-builder-page/show-builder.store.spec.ts"
    ]
  },
  {
    "id": "W6",
    "name": "compatible ignores gravity",
    "file": "src/engine/loop/timeline-driver.ts",
    "old": "from.sky.gravity === this.sky.gravity &&",
    "new": "/* W6 */",
    "specs": [
      "src/engine/loop/timeline-driver.spec.ts",
      "src/app/shared/fireworks-stage/fireworks-stage.phase7.spec.ts",
      "src/app/features/show/pages/show-builder-page/show-builder.store.spec.ts"
    ]
  },
  {
    "id": "W7",
    "name": "compatible ignores wind",
    "file": "src/engine/loop/timeline-driver.ts",
    "old": "from.sky.wind === this.sky.wind\n",
    "new": "true\n",
    "specs": [
      "src/engine/loop/timeline-driver.spec.ts",
      "src/app/shared/fireworks-stage/fireworks-stage.phase7.spec.ts",
      "src/app/features/show/pages/show-builder-page/show-builder.store.spec.ts"
    ]
  },
  {
    "id": "W8",
    "name": "M10 shadow starBudget unsynced",
    "file": "src/app/shared/fireworks-stage/fireworks-stage.ts",
    "old": "warm.sim.starBudget = this.sim.starBudget;",
    "new": "/* M10 */",
    "specs": [
      "src/app/shared/fireworks-stage/fireworks-stage.phase7.spec.ts",
      "src/app/shared/fireworks-stage/fireworks-stage.timeline.spec.ts"
    ]
  },
  {
    "id": "W9",
    "name": "shadow fixed width",
    "file": "src/app/shared/fireworks-stage/fireworks-stage.ts",
    "old": "worldWidth: () => this.worldWidth(),\n        driver: shadow,",
    "new": "worldWidth: () => 1280,\n        driver: shadow,",
    "specs": [
      "src/app/shared/fireworks-stage/fireworks-stage.phase7.spec.ts",
      "src/app/shared/fireworks-stage/fireworks-stage.timeline.spec.ts"
    ]
  },
  {
    "id": "J1",
    "name": "Show JSON returns the raw parsed value",
    "file": "src/app/features/show/shared/show-json.ts",
    "old": "return { ok: true, show: result.show, note:",
    "new": "return { ok: true, show: parsed as never, note:",
    "specs": [
      "src/app/features/show/shared/show-json.spec.ts",
      "src/app/features/show/pages/show-builder-page/show-builder-page.phase7.spec.ts",
      "src/app/features/designer/designer-structure.spec.ts",
      "src/app/features/show/pages/show-builder-page/show-builder.store.spec.ts"
    ]
  },
  {
    "id": "J2",
    "name": "applyShow keeps a gone embedded active shell",
    "file": "src/app/features/show/pages/show-builder-page/show-builder.store.ts",
    "old": "if (active.kind === 'embedded' && !Object.hasOwn(show.shells, active.key)) {",
    "new": "if (active.kind === 'embedded' && !Object.hasOwn(show.shells, active.key) && false) {",
    "specs": [
      "src/app/features/show/shared/show-json.spec.ts",
      "src/app/features/show/pages/show-builder-page/show-builder-page.phase7.spec.ts",
      "src/app/features/designer/designer-structure.spec.ts",
      "src/app/features/show/pages/show-builder-page/show-builder.store.spec.ts"
    ]
  },
  {
    "id": "F1",
    "name": "helper uses in",
    "file": "src/engine/model/show.ts",
    "old": "return Object.hasOwn(show.shells, key) ? show.shells[key] : undefined;",
    "new": "return (show.shells as Record<string, S>)[key];",
    "specs": [
      "src/app/embedded-shell-reads.spec.ts",
      "src/app/features/show",
      "src/app/features/player"
    ]
  },
  {
    "id": "F2",
    "name": "removeShell aliased bare read",
    "file": "src/app/features/show/pages/show-builder-page/show-builder.store.ts",
    "old": "if (!Object.hasOwn(show.shells, key)) return;",
    "new": "const map: Record<string, unknown> = show.shells;\n    if (map[key] === undefined) return;",
    "specs": [
      "src/app/embedded-shell-reads.spec.ts",
      "src/app/features/show",
      "src/app/features/player"
    ]
  },
  {
    "id": "F3",
    "name": "player strobe check aliased bare read",
    "file": "src/app/features/player/pages/player-page/player-page.ts",
    "old": "embeddedShell(show, k)?.breaks",
    "new": "(show.shells as Record<string, typeof show.shells[string]>)[k]?.breaks",
    "specs": [
      "src/app/embedded-shell-reads.spec.ts",
      "src/app/features/show",
      "src/app/features/player"
    ]
  }
],
};
