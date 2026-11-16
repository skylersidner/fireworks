// F1 fix (Yoshi): two targeted mutants on the run-key staleness check in TimelineDriver.beforeStep.
// Record: .squad/decisions/records/yoshi-phase6-timeline-driver.md (F1 addendum).
const specs = [
  'src/engine/loop/timeline-driver.run-key.spec.ts',
  'src/engine/loop/timeline-driver.property.spec.ts',
];
export default {
  kind: 'web',
  description: 'F1: a step under another run key leaves the run stale (no checkpoints, next seek re-runs)',
  mutants: [
    {
      id: 'F1a',
      name: 'stale check never clears the run key',
      file: 'src/engine/loop/timeline-driver.ts',
      old: '    )\n      this.runKey = null;',
      new: '    )\n      void 0;',
      specs,
    },
    {
      id: 'F1b',
      name: 'stale check ignores width',
      file: 'src/engine/loop/timeline-driver.ts',
      old: '(rk.width !== ctx.worldWidth() ||',
      new: '(false ||',
      specs,
    },
  ],
};
