// T3 property-test mutant proof (Toad, testing interlude batch 2). The 40 TimelineDriver mutants
// from Luigi's spec-split proof (scratchpad luigi-int/mut/mut.py, T01-T40; record
// luigi-interlude-spec-split.md), run against the T3 property file ALONE, so a kill here is a
// kill by the property test and nothing else. `target` marks the six that survived both Luigi's
// old and new sets (T22, T23, T32, T35, T36, T38). F03 (designer draft with no debounce) runs
// against shell-designer.store.spec.ts, the spec Luigi named as its owner. T23 (checkpoint ignores
// the run key) was removed on 2026-11-17 with the dead check it mutated: since the F1 fix,
// beforeStep nulls runKey on any key change (luigi-end-review-cpu-fixes.md addendum).
// Results and the redundancy list: .squad/decisions/records/toad-interlude-t3-property-tests.md.
export default {
  kind: 'web',
  description: 'T3: TimelineDriver mutants vs the seeded property test alone; F03 vs the designer store spec',
  mutants: [
    {
      "id": "T01",
      "name": "fire < not <=",
      "file": "src/engine/loop/timeline-driver.ts",
      "old": "schedule[this.next].fireStep <= k)",
      "new": "schedule[this.next].fireStep < k)",
      "specs": [
        "src/engine/loop/timeline-driver.property.spec.ts"
      ]
    },
    {
      "id": "T02",
      "name": "checkpoint grid off by one",
      "file": "src/engine/loop/timeline-driver.ts",
      "old": "if (this.cpSteps > 0 && k % this.cpSteps === 0) this.takeCheckpoint(ctx);",
      "new": "if (this.cpSteps > 0 && (k + 1) % this.cpSteps === 0) this.takeCheckpoint(ctx);",
      "specs": [
        "src/engine/loop/timeline-driver.property.spec.ts"
      ]
    },
    {
      "id": "T03",
      "name": "seek never jumps forward to a checkpoint",
      "file": "src/engine/loop/timeline-driver.ts",
      "old": "if (cp && (behind || cp.step > this.k)) this.restore(ctx, cp);",
      "new": "if (cp && behind) this.restore(ctx, cp);",
      "specs": [
        "src/engine/loop/timeline-driver.property.spec.ts"
      ]
    },
    {
      "id": "T04",
      "name": "latest checkpoint strictly before",
      "file": "src/engine/loop/timeline-driver.ts",
      "old": "for (const c of this.checkpoints) if (c.step <= step) best = c;",
      "new": "for (const c of this.checkpoints) if (c.step < step) best = c;",
      "specs": [
        "src/engine/loop/timeline-driver.property.spec.ts"
      ]
    },
    {
      "id": "T05",
      "name": "W3 restore trusts old endStep",
      "file": "src/engine/loop/timeline-driver.ts",
      "old": "this._endStep = cp.next === this.schedule.length ? cp.endStep : null;",
      "new": "this._endStep = cp.endStep;",
      "specs": [
        "src/engine/loop/timeline-driver.property.spec.ts"
      ]
    },
    {
      "id": "T06",
      "name": "restore drops first ledger row",
      "file": "src/engine/loop/timeline-driver.ts",
      "old": "this._ledger = [...cp.ledger];",
      "new": "this._ledger = [...cp.ledger].slice(1);",
      "specs": [
        "src/engine/loop/timeline-driver.property.spec.ts"
      ]
    },
    {
      "id": "T07",
      "name": "restore wrong digest",
      "file": "src/engine/loop/timeline-driver.ts",
      "old": "this.digest = cp.digest;",
      "new": "this.digest = cp.digest ^ 1;",
      "specs": [
        "src/engine/loop/timeline-driver.property.spec.ts"
      ]
    },
    {
      "id": "T08",
      "name": "restore refires a cue",
      "file": "src/engine/loop/timeline-driver.ts",
      "old": "this.next = cp.next;",
      "new": "this.next = Math.max(0, cp.next - 1);",
      "specs": [
        "src/engine/loop/timeline-driver.property.spec.ts"
      ]
    },
    {
      "id": "T09",
      "name": "memory cap keeps two",
      "file": "src/engine/loop/timeline-driver.ts",
      "old": "while (this.checkpointBytes > this.cpBytesMax && this.checkpoints.length > 1) {",
      "new": "while (this.checkpointBytes > this.cpBytesMax && this.checkpoints.length > 2) {",
      "specs": [
        "src/engine/loop/timeline-driver.property.spec.ts"
      ]
    },
    {
      "id": "T10",
      "name": "N1/W1 no prefix cap",
      "file": "src/engine/loop/timeline-driver.ts",
      "old": "  return i === b.length && i < a.length ? Math.min(d, b.at(-1)?.fireStep ?? 0) : d;",
      "new": "  return d;",
      "specs": [
        "src/engine/loop/timeline-driver.property.spec.ts"
      ]
    },
    {
      "id": "T11",
      "name": "W2 empty receiver keeps all",
      "file": "src/engine/loop/timeline-driver.ts",
      "old": "b.at(-1)?.fireStep ?? 0) : d;",
      "new": "b.at(-1)?.fireStep ?? Infinity) : d;",
      "specs": [
        "src/engine/loop/timeline-driver.property.spec.ts"
      ]
    },
    {
      "id": "T12",
      "name": "N2 cap at sender last",
      "file": "src/engine/loop/timeline-driver.ts",
      "old": "  return i === b.length && i < a.length ? Math.min(d, b.at(-1)?.fireStep ?? 0) : d;",
      "new": "  return i === b.length && i < a.length ? Math.min(d, a.at(-1)?.fireStep ?? 0) : d;",
      "specs": [
        "src/engine/loop/timeline-driver.property.spec.ts"
      ]
    },
    {
      "id": "T13",
      "name": "N3 cap one interval late",
      "file": "src/engine/loop/timeline-driver.ts",
      "old": "  return i === b.length && i < a.length ? Math.min(d, b.at(-1)?.fireStep ?? 0) : d;",
      "new": "  return i === b.length && i < a.length ? Math.min(d, (b.at(-1)?.fireStep ?? 0) + 1200) : d;",
      "specs": [
        "src/engine/loop/timeline-driver.property.spec.ts"
      ]
    },
    {
      "id": "T14",
      "name": "N4 adopt args swapped",
      "file": "src/engine/loop/timeline-driver.ts",
      "old": "    const diverge = divergeStep(from.schedule, this.schedule);\n    this.cpSteps = Math.max(",
      "new": "    const diverge = divergeStep(this.schedule, from.schedule);\n    this.cpSteps = Math.max(",
      "specs": [
        "src/engine/loop/timeline-driver.property.spec.ts"
      ]
    },
    {
      "id": "T15",
      "name": "N5 inherit args swapped",
      "file": "src/engine/loop/timeline-driver.ts",
      "old": "    const diverge = divergeStep(from.schedule, this.schedule);\n    this.cpSteps = from.cpSteps;",
      "new": "    const diverge = divergeStep(this.schedule, from.schedule);\n    this.cpSteps = from.cpSteps;",
      "specs": [
        "src/engine/loop/timeline-driver.property.spec.ts"
      ]
    },
    {
      "id": "T16",
      "name": "M8 inherit off-propagation",
      "file": "src/engine/loop/timeline-driver.ts",
      "old": "  private inherit(from: TimelineDriver): void {\n    if (!this.compatible(from)) return;",
      "new": "  private inherit(from: TimelineDriver): void {\n    if (from.cpSteps === 0) { this.cpSteps = 0; return; }\n    if (!this.compatible(from)) return;",
      "specs": [
        "src/engine/loop/timeline-driver.property.spec.ts"
      ]
    },
    {
      "id": "T17",
      "name": "W4 adopt one interval past divergence",
      "file": "src/engine/loop/timeline-driver.ts",
      "old": "(c) => c.step <= diverge && !held.has(c.step)",
      "new": "(c) => c.step <= diverge + 1200 && !held.has(c.step)",
      "specs": [
        "src/engine/loop/timeline-driver.property.spec.ts"
      ]
    },
    {
      "id": "T18",
      "name": "W5/M9 compatible ignores digest",
      "file": "src/engine/loop/timeline-driver.ts",
      "old": "from.digestOn === this.digestOn &&",
      "new": "/* M9 */",
      "specs": [
        "src/engine/loop/timeline-driver.property.spec.ts"
      ]
    },
    {
      "id": "T19",
      "name": "W6 compatible ignores gravity",
      "file": "src/engine/loop/timeline-driver.ts",
      "old": "from.sky.gravity === this.sky.gravity &&",
      "new": "/* W6 */",
      "specs": [
        "src/engine/loop/timeline-driver.property.spec.ts"
      ]
    },
    {
      "id": "T20",
      "name": "W7 compatible ignores wind",
      "file": "src/engine/loop/timeline-driver.ts",
      "old": "from.sky.wind === this.sky.wind\n",
      "new": "true\n",
      "specs": [
        "src/engine/loop/timeline-driver.property.spec.ts"
      ]
    },
    {
      "id": "T21",
      "name": "adopt ignores the grid",
      "file": "src/engine/loop/timeline-driver.ts",
      "old": "(c) => c.step <= diverge && !held.has(c.step) && c.step % this.cpSteps === 0,",
      "new": "(c) => c.step <= diverge && !held.has(c.step),",
      "specs": [
        "src/engine/loop/timeline-driver.property.spec.ts"
      ]
    },
    {
      "id": "T22",
      "name": "adopt takes the narrower spacing",
      "file": "src/engine/loop/timeline-driver.ts",
      "old": "this.cpSteps = Math.max(this.cpSteps, from.cpSteps);",
      "new": "this.cpSteps = Math.min(this.cpSteps, from.cpSteps);",
      "specs": [
        "src/engine/loop/timeline-driver.property.spec.ts"
      ],
      "target": "survived Luigi old and new sets (luigi-interlude-spec-split.md, finding 3)"
    },
    {
      "id": "T24",
      "name": "seek keeps other-key checkpoints",
      "file": "src/engine/loop/timeline-driver.ts",
      "old": "this.checkpoints = this.checkpoints.filter((c) => sameKey(c.key, key));",
      "new": "/* T24 */",
      "specs": [
        "src/engine/loop/timeline-driver.property.spec.ts"
      ]
    },
    {
      "id": "T25",
      "name": "run key ignores width",
      "file": "src/engine/loop/timeline-driver.ts",
      "old": "return a.width === b.width && a.starBudget === b.starBudget && a.capacity === b.capacity;",
      "new": "return a.starBudget === b.starBudget && a.capacity === b.capacity;",
      "specs": [
        "src/engine/loop/timeline-driver.property.spec.ts"
      ]
    },
    {
      "id": "T26",
      "name": "run key ignores starBudget",
      "file": "src/engine/loop/timeline-driver.ts",
      "old": "return a.width === b.width && a.starBudget === b.starBudget && a.capacity === b.capacity;",
      "new": "return a.width === b.width && a.capacity === b.capacity;",
      "specs": [
        "src/engine/loop/timeline-driver.property.spec.ts"
      ]
    },
    {
      "id": "T27",
      "name": "run key ignores capacity",
      "file": "src/engine/loop/timeline-driver.ts",
      "old": "return a.width === b.width && a.starBudget === b.starBudget && a.capacity === b.capacity;",
      "new": "return a.width === b.width && a.starBudget === b.starBudget;",
      "specs": [
        "src/engine/loop/timeline-driver.property.spec.ts"
      ]
    },
    {
      "id": "T28",
      "name": "diverge ignores seed",
      "file": "src/engine/loop/timeline-driver.ts",
      "old": "    a.cue.seed === b.cue.seed &&\n",
      "new": "/* T28 */\n",
      "specs": [
        "src/engine/loop/timeline-driver.property.spec.ts"
      ]
    },
    {
      "id": "T29",
      "name": "diverge ignores x",
      "file": "src/engine/loop/timeline-driver.ts",
      "old": "    a.cue.x === b.cue.x &&\n",
      "new": "/* T29 */\n",
      "specs": [
        "src/engine/loop/timeline-driver.property.spec.ts"
      ]
    },
    {
      "id": "T30",
      "name": "diverge ignores the shell",
      "file": "src/engine/loop/timeline-driver.ts",
      "old": "    a.ty === b.ty &&\n    // Key order can differ between equal shells; that only costs a checkpoint, never exactness.\n    JSON.stringify(a.def) === JSON.stringify(b.def)",
      "new": "    a.ty === b.ty /* T30 */",
      "specs": [
        "src/engine/loop/timeline-driver.property.spec.ts"
      ]
    },
    {
      "id": "T31",
      "name": "diverge at the later step",
      "file": "src/engine/loop/timeline-driver.ts",
      "old": "const d = Math.min(a[i]?.fireStep ?? Infinity, b[i]?.fireStep ?? Infinity);",
      "new": "const d = Math.max(a[i]?.fireStep ?? 0, b[i]?.fireStep ?? 0);",
      "specs": [
        "src/engine/loop/timeline-driver.property.spec.ts"
      ]
    },
    {
      "id": "T32",
      "name": "twin without checkpoints",
      "file": "src/engine/loop/timeline-driver.ts",
      "old": "      from: this,\n      checkpointSteps: this.cpSteps,",
      "new": "      checkpointSteps: this.cpSteps, /* T32 */",
      "specs": [
        "src/engine/loop/timeline-driver.property.spec.ts"
      ],
      "target": "survived Luigi old and new sets (luigi-interlude-spec-split.md, finding 3)"
    },
    {
      "id": "T33",
      "name": "end ignores shells in flight",
      "file": "src/engine/loop/timeline-driver.ts",
      "old": "      sim.shellCount === 0 &&\n",
      "new": "/* T33 */\n",
      "specs": [
        "src/engine/loop/timeline-driver.property.spec.ts"
      ]
    },
    {
      "id": "T34",
      "name": "checkpoint ledger by reference",
      "file": "src/engine/loop/timeline-driver.ts",
      "old": "      ledger: [...this._ledger],",
      "new": "      ledger: this._ledger,",
      "specs": [
        "src/engine/loop/timeline-driver.property.spec.ts"
      ]
    },
    {
      "id": "T35",
      "name": "checkpoint forgets endStep",
      "file": "src/engine/loop/timeline-driver.ts",
      "old": "      endStep: this._endStep,",
      "new": "      endStep: null,",
      "specs": [
        "src/engine/loop/timeline-driver.property.spec.ts"
      ],
      "target": "survived Luigi old and new sets (luigi-interlude-spec-split.md, finding 3)"
    },
    {
      "id": "T36",
      "name": "inherit keeps its own spacing",
      "file": "src/engine/loop/timeline-driver.ts",
      "old": "    this.cpSteps = from.cpSteps;\n    this.checkpoints",
      "new": "    this.cpSteps = this.cpSteps;\n    this.checkpoints",
      "specs": [
        "src/engine/loop/timeline-driver.property.spec.ts"
      ],
      "target": "survived Luigi old and new sets (luigi-interlude-spec-split.md, finding 3)"
    },
    {
      "id": "T37",
      "name": "td-inherit-none",
      "file": "src/engine/loop/timeline-driver.ts",
      "old": "this.checkpoints = from.checkpoints.filter((c) => c.step <= diverge);",
      "new": "this.checkpoints = [];",
      "specs": [
        "src/engine/loop/timeline-driver.property.spec.ts"
      ]
    },
    {
      "id": "T38",
      "name": "digest not folded on step 1",
      "file": "src/engine/loop/timeline-driver.ts",
      "old": "if (this.digestOn) this.foldCounts(ctx.sim);",
      "new": "if (this.digestOn && k > 1) this.foldCounts(ctx.sim);",
      "specs": [
        "src/engine/loop/timeline-driver.property.spec.ts"
      ],
      "target": "survived Luigi old and new sets (luigi-interlude-spec-split.md, finding 3)"
    },
    {
      "id": "T39",
      "name": "reset keeps the fired pointer",
      "file": "src/engine/loop/timeline-driver.ts",
      "old": "    this.k = 0;\n    this.next = 0;",
      "new": "    this.k = 0;\n    this.next = Math.min(this.next, 1);",
      "specs": [
        "src/engine/loop/timeline-driver.property.spec.ts"
      ]
    },
    {
      "id": "T40",
      "name": "restore keeps the sim sky",
      "file": "src/engine/loop/timeline-driver.ts",
      "old": "    ctx.sim.restore(cp.sim);\n    ctx.sim.sky = { ...this.sky };",
      "new": "    ctx.sim.restore(cp.sim); /* T40 */",
      "specs": [
        "src/engine/loop/timeline-driver.property.spec.ts"
      ]
    },
    {
      "id": "F03",
      "name": "designer no debounce",
      "file": "src/app/features/designer/pages/designer-page/shell-designer.store.ts",
      "old": "setTimeout(() => this.flushDraft(), DRAFT_DEBOUNCE_MS);",
      "new": "setTimeout(() => this.flushDraft(), 0);",
      "specs": [
        "src/app/features/designer/pages/designer-page/shell-designer.store.spec.ts"
      ]
    }
  ],
};
