// Phase 6 web mutants (Toad, Phase 6 QA: 48 mutants; 11 were killed only by Toad's tests). Moved
// from scratchpad toad-p6/mut.py (M, M2 and the appended-text T set). Targets: Show Builder Undo,
// cue counter, edits, caps, save and share, link dispatch, stage end/seek, player Replay, flash
// spacing, the structure and sink guards.
// Some may report STALE where Phase 7 moved the code (td-inherit-none's line changed in C3):
// update the old text from the current source, never widen it.
export default {
  kind: 'web',
  description: 'Phase 6: Show Builder store, stage end/seek, player Replay, flash spacing, guards',
  mutants: [
  {
    "id": "undo-limit+1",
    "name": "undo-limit+1",
    "file": "src/app/features/show/pages/show-builder-page/show-builder.store.ts",
    "old": "if (this.past.length > UNDO_LIMIT) this.past.shift();",
    "new": "if (this.past.length > UNDO_LIMIT + 1) this.past.shift();",
    "specs": [
      "src/app/features/show/pages/show-builder-page/show-builder.store.spec.ts"
    ]
  },
  {
    "id": "undo-no-dirty",
    "name": "undo-no-dirty",
    "file": "src/app/features/show/pages/show-builder-page/show-builder.store.ts",
    "old": "this.show.set(prev);\n    this.dirty.set(true);",
    "new": "this.show.set(prev);\n    /* toad-mut */",
    "specs": [
      "src/app/features/show/pages/show-builder-page/show-builder.store.spec.ts",
      "src/app/features/show/pages/show-builder-page/show-builder-page.spec.ts"
    ]
  },
  {
    "id": "undo-restores-counter",
    "name": "undo-restores-counter",
    "file": "src/app/features/show/pages/show-builder-page/show-builder.store.ts",
    "old": "this.show.set(prev);\n",
    "new": "this.show.set(prev);\n    this.nextCueId.set(nextCueIdAfter(prev));\n",
    "specs": [
      "src/app/features/show/pages/show-builder-page/show-builder.store.spec.ts",
      "src/app/features/show/pages/show-builder-page/show-builder-page.spec.ts"
    ]
  },
  {
    "id": "edit-keeps-future",
    "name": "edit-keeps-future",
    "file": "src/app/features/show/pages/show-builder-page/show-builder.store.ts",
    "old": "this.lastCoalesce = coalesce;\n    this.future = [];",
    "new": "this.lastCoalesce = coalesce;\n    /* toad-mut */",
    "specs": [
      "src/app/features/show/pages/show-builder-page/show-builder.store.spec.ts",
      "src/app/features/show/pages/show-builder-page/show-builder-page.spec.ts"
    ]
  },
  {
    "id": "coalesce-never",
    "name": "coalesce-never",
    "file": "src/app/features/show/pages/show-builder-page/show-builder.store.ts",
    "old": "if (coalesce === null || coalesce !== this.lastCoalesce) {",
    "new": "if (true) {",
    "specs": [
      "src/app/features/show/pages/show-builder-page/show-builder.store.spec.ts"
    ]
  },
  {
    "id": "coalesce-always",
    "name": "coalesce-always",
    "file": "src/app/features/show/pages/show-builder-page/show-builder.store.ts",
    "old": "if (coalesce === null || coalesce !== this.lastCoalesce) {",
    "new": "if (this.past.length === 0) {",
    "specs": [
      "src/app/features/show/pages/show-builder-page/show-builder.store.spec.ts"
    ]
  },
  {
    "id": "key-field-undo-hijacked",
    "name": "key-field-undo-hijacked",
    "file": "src/app/features/show/pages/show-builder-page/show-builder-page.ts",
    "old": "if (el?.closest(FORM_FIELDS)) return;",
    "new": "if (el?.closest(\"textarea\")) return;",
    "specs": [
      "src/app/features/show/pages/show-builder-page/show-builder-page.spec.ts"
    ],
    "refreshed": "2026-11-15 (Toad T3): old text re-taken from the current source"
  },
  {
    "id": "key-no-meta",
    "name": "key-no-meta",
    "file": "src/app/features/show/pages/show-builder-page/show-builder-page.ts",
    "old": "if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'z') {",
    "new": "if (event.ctrlKey && !event.altKey && event.key.toLowerCase() === 'z') {",
    "specs": [
      "src/app/features/show/pages/show-builder-page/show-builder-page.spec.ts"
    ]
  },
  {
    "id": "key-no-redo",
    "name": "key-no-redo",
    "file": "src/app/features/show/pages/show-builder-page/show-builder-page.ts",
    "old": "this.historyStep(event.shiftKey);",
    "new": "this.historyStep(!event.shiftKey && false);",
    "specs": [
      "src/app/features/show/pages/show-builder-page/show-builder-page.spec.ts"
    ],
    "refreshed": "2026-11-15 (Toad T3): old text re-taken from the current source"
  },
  {
    "id": "add-no-counter",
    "name": "add-no-counter",
    "file": "src/app/features/show/pages/show-builder-page/show-builder.store.ts",
    "old": "this.edit(withCue(embedded.show, cue));\n    this.nextCueId.set(next);",
    "new": "this.edit(withCue(embedded.show, cue));\n    /* toad-mut */",
    "specs": [
      "src/app/features/show/pages/show-builder-page/show-builder.store.spec.ts",
      "src/app/features/show/pages/show-builder-page/show-builder-page.spec.ts"
    ]
  },
  {
    "id": "dup-no-counter",
    "name": "dup-no-counter",
    "file": "src/app/features/show/pages/show-builder-page/show-builder.store.ts",
    "old": "this.edit(withCue(show, copy));\n    this.nextCueId.set(next);",
    "new": "this.edit(withCue(show, copy));\n    /* toad-mut */",
    "specs": [
      "src/app/features/show/pages/show-builder-page/show-builder.store.spec.ts",
      "src/app/features/show/pages/show-builder-page/show-builder-page.spec.ts"
    ]
  },
  {
    "id": "load-counter-1",
    "name": "load-counter-1",
    "file": "src/app/features/show/pages/show-builder-page/show-builder.store.ts",
    "old": "this.show.set({ ...show, shells: { ...show.shells } });\n    this.nextCueId.set(nextCueIdAfter(show));",
    "new": "this.show.set({ ...show, shells: { ...show.shells } });\n    this.nextCueId.set(1 /* toad */);",
    "specs": [
      "src/app/features/show/pages/show-builder-page/show-builder.store.spec.ts",
      "src/app/features/show/pages/show-builder-page/show-builder-page.spec.ts"
    ],
    "refreshed": "2026-11-15 (Toad T3): old text re-taken from the current source"
  },
  {
    "id": "cue-cap-off-by-1",
    "name": "cue-cap-off-by-1",
    "file": "src/app/features/show/shared/show-edit.ts",
    "old": "return show.cues.length >= MAX_SHOW_CUES;",
    "new": "return show.cues.length > MAX_SHOW_CUES;",
    "specs": [
      "src/app/features/show/pages/show-builder-page/show-builder.store.spec.ts",
      "src/app/features/show/shared/show-edit.spec.ts"
    ]
  },
  {
    "id": "shell-cap-off-by-1",
    "name": "shell-cap-off-by-1",
    "file": "src/app/features/show/shared/show-edit.ts",
    "old": "if (Object.keys(show.shells).length >= MAX_SHOW_SHELLS) return",
    "new": "if (Object.keys(show.shells).length > MAX_SHOW_SHELLS) return",
    "specs": [
      "src/app/features/show/pages/show-builder-page/show-builder.store.spec.ts",
      "src/app/features/show/shared/show-edit.spec.ts"
    ]
  },
  {
    "id": "shell-no-reuse",
    "name": "shell-no-reuse",
    "file": "src/app/features/show/shared/show-edit.ts",
    "old": "if (existing) return { ok: true, show, key: existing };",
    "new": "if (existing && false) return { ok: true, show, key: existing };",
    "specs": [
      "src/app/features/show/pages/show-builder-page/show-builder.store.spec.ts",
      "src/app/features/show/shared/show-edit.spec.ts",
      "src/app/features/show/pages/show-builder-page/show-save.spec.ts"
    ]
  },
  {
    "id": "shell-reuse-order-sensitive",
    "name": "shell-reuse-order-sensitive",
    "file": "src/app/features/show/shared/show-edit.ts",
    "old": "Object.keys(b)\n          .sort()",
    "new": "Object.keys(b) /* toad */",
    "specs": [
      "src/app/features/show/pages/show-builder-page/show-builder.store.spec.ts",
      "src/app/features/show/shared/show-edit.spec.ts",
      "src/app/features/show/pages/show-builder-page/show-save.spec.ts"
    ]
  },
  {
    "id": "duration-floor-only-min",
    "name": "duration-floor-only-min",
    "file": "src/app/features/show/pages/show-builder-page/show-builder.store.ts",
    "old": "if (d < minDuration(show) ||",
    "new": "if (d < SHOW_LIMITS.duration.min ||",
    "specs": [
      "src/app/features/show/pages/show-builder-page/show-builder.store.spec.ts",
      "src/app/features/show/pages/show-builder-page/show-builder-page.spec.ts"
    ]
  },
  {
    "id": "empty-save-guard",
    "name": "empty-save-guard",
    "file": "src/app/features/show/pages/show-builder-page/show-save.ts",
    "old": "if (this.cannotSave() !== null) return;",
    "new": "/* toad-mut */",
    "specs": [
      "src/app/features/show/pages/show-builder-page/show-save.spec.ts",
      "src/app/features/show/pages/show-builder-page/show-builder-page.spec.ts"
    ]
  },
  {
    "id": "empty-save-note",
    "name": "empty-save-note",
    "file": "src/app/features/show/pages/show-builder-page/show-save.ts",
    "old": "this.store.show().cues.length === 0 ? EMPTY_SAVE_NOTE : null",
    "new": "this.store.show().cues.length === -1 ? EMPTY_SAVE_NOTE : null",
    "specs": [
      "src/app/features/show/pages/show-builder-page/show-save.spec.ts",
      "src/app/features/show/pages/show-builder-page/show-builder-page.spec.ts"
    ]
  },
  {
    "id": "dispatch-show-off",
    "name": "dispatch-show-off",
    "file": "src/app/features/designer/pages/open-link-page/open-link-page.ts",
    "old": "if (opened.status === 'show') {",
    "new": "if (opened.status === 'show' && false) {",
    "specs": [
      "src/app/features/show/pages/show-builder-page/show-builder-page.spec.ts",
      "src/app/features/designer/pages/open-link-page/open-link-page.spec.ts"
    ]
  },
  {
    "id": "dispatch-opens-as-shell",
    "name": "dispatch-opens-as-shell",
    "file": "src/app/core/open-creation.ts",
    "old": "const opened = kind === 'shell' ? openShell(r.document) : openShow(r.document);",
    "new": "const opened = openShell(r.document);",
    "specs": [
      "src/app/features/show/pages/show-builder-page/show-builder-page.spec.ts",
      "src/app/features/designer/pages/open-link-page/open-link-page.spec.ts",
      "src/app/features/player/pages/player-page/player-page.show.spec.ts"
    ]
  },
  {
    "id": "link-asks-on-designer-dirty",
    "name": "link-asks-on-designer-dirty",
    "file": "src/app/features/show/pages/show-builder-page/show-builder.store.ts",
    "old": "if (untracked(this.dirty)) {\n      this.pending.set({ kind: 'link', copy });",
    "new": "if (untracked(this.dirty) || readDraft(this.storage)?.shellDirty) {\n      this.pending.set({ kind: 'link', copy });",
    "specs": [
      "src/app/features/show/pages/show-builder-page/show-builder.store.spec.ts",
      "src/app/features/show/pages/show-builder-page/show-builder-page.spec.ts"
    ]
  },
  {
    "id": "link-never-asks",
    "name": "link-never-asks",
    "file": "src/app/features/show/pages/show-builder-page/show-builder.store.ts",
    "old": "if (untracked(this.dirty)) {\n      this.pending.set({ kind: 'link', copy });",
    "new": "if (false) {\n      this.pending.set({ kind: 'link', copy });",
    "specs": [
      "src/app/features/show/pages/show-builder-page/show-builder.store.spec.ts",
      "src/app/features/show/pages/show-builder-page/show-builder-page.spec.ts"
    ]
  },
  {
    "id": "stage-ended-never",
    "name": "stage-ended-never",
    "file": "src/app/shared/fireworks-stage/fireworks-stage.ts",
    "old": "if (!untracked(this.paused)) this.ended.emit(",
    "new": "if (false) this.ended.emit(",
    "specs": [
      "src/app/shared/fireworks-stage/fireworks-stage.timeline.spec.ts",
      "src/app/features/player/pages/player-page/player-page.show.spec.ts"
    ]
  },
  {
    "id": "stage-ended-repeats",
    "name": "stage-ended-repeats",
    "file": "src/app/shared/fireworks-stage/fireworks-stage.ts",
    "old": "this.endedReported = true;\n",
    "new": "/* toad-mut */\n",
    "specs": [
      "src/app/shared/fireworks-stage/fireworks-stage.timeline.spec.ts",
      "src/app/features/player/pages/player-page/player-page.show.spec.ts"
    ]
  },
  {
    "id": "stage-steps-after-done",
    "name": "stage-steps-after-done",
    "file": "src/app/shared/fireworks-stage/fireworks-stage.ts",
    "old": "} else if (!untracked(this.paused) && !timeline.done) {",
    "new": "} else if (!untracked(this.paused)) {",
    "specs": [
      "src/app/shared/fireworks-stage/fireworks-stage.timeline.spec.ts",
      "src/app/features/player/pages/player-page/player-page.show.spec.ts"
    ]
  },
  {
    "id": "stage-click-fires",
    "name": "stage-click-fires",
    "file": "src/app/shared/fireworks-stage/fireworks-stage.ts",
    "old": "this.skyClick.emit({ x: Math.min(1, Math.max(0, w > 0 ? x / w : 0.5)), y });\n      return;",
    "new": "this.skyClick.emit({ x: Math.min(1, Math.max(0, w > 0 ? x / w : 0.5)), y });\n      /* toad-mut */",
    "specs": [
      "src/app/shared/fireworks-stage/fireworks-stage.timeline.spec.ts",
      "src/app/features/player/pages/player-page/player-page.show.spec.ts"
    ]
  },
  {
    "id": "stage-edit-reseeks-0",
    "name": "stage-edit-reseeks-0",
    "file": "src/app/shared/fireworks-stage/fireworks-stage.ts",
    "old": "if (this.seekTarget === null) this.requestSeek(at);",
    "new": "if (this.seekTarget === null) this.requestSeek(0);",
    "specs": [
      "src/app/shared/fireworks-stage/fireworks-stage.timeline.spec.ts",
      "src/app/features/show/pages/show-builder-page/show-builder-page.spec.ts"
    ],
    "refreshed": "2026-11-15 (Toad T3): old text re-taken from the current source"
  },
  {
    "id": "stage-edit-no-reseek",
    "name": "stage-edit-no-reseek",
    "file": "src/app/shared/fireworks-stage/fireworks-stage.ts",
    "old": "if (this.seekTarget === null) this.requestSeek(at);",
    "new": "if (this.seekTarget === null && !previous) this.requestSeek(at);",
    "specs": [
      "src/app/shared/fireworks-stage/fireworks-stage.timeline.spec.ts",
      "src/app/features/show/pages/show-builder-page/show-builder-page.spec.ts"
    ],
    "refreshed": "2026-11-15 (Toad T3): old text re-taken from the current source"
  },
  {
    "id": "td-inherit-none",
    "name": "td-inherit-none",
    "file": "src/engine/loop/timeline-driver.ts",
    "old": "this.checkpoints = from.checkpoints.filter((c) => c.step <= diverge);",
    "new": "this.checkpoints = [];",
    "specs": [
      "src/app/shared/fireworks-stage/fireworks-stage.timeline.spec.ts",
      "src/engine/loop/timeline-driver.spec.ts"
    ]
  },
  {
    "id": "player-replay-no-seek",
    "name": "player-replay-no-seek",
    "file": "src/app/features/player/pages/player-page/player-page.ts",
    "old": "this.stage()?.seek(0);\n      this.ended.set(false);",
    "new": "/* toad-mut */\n      this.ended.set(false);",
    "specs": [
      "src/app/features/player/pages/player-page/player-page.show.spec.ts"
    ]
  },
  {
    "id": "player-replay-no-unpause",
    "name": "player-replay-no-unpause",
    "file": "src/app/features/player/pages/player-page/player-page.ts",
    "old": "this.showCenterPlay.set(false);\n      this.userPaused.set(false);\n      this.lastSecond = -1;",
    "new": "this.showCenterPlay.set(false);\n      this.lastSecond = -1;",
    "specs": [
      "src/app/features/player/pages/player-page/player-page.show.spec.ts"
    ]
  },
  {
    "id": "player-ended-not-shown",
    "name": "player-ended-not-shown",
    "file": "src/app/features/player/pages/player-page/player-page.ts",
    "old": "protected onShowEnded(): void {\n    this.ended.set(true);",
    "new": "protected onShowEnded(): void {\n    this.ended.set(false);",
    "specs": [
      "src/app/features/player/pages/player-page/player-page.show.spec.ts"
    ]
  },
  {
    "id": "flash-spacing-39",
    "name": "flash-spacing-39",
    "file": "src/engine/render/visual-rules.ts",
    "old": "const draw = start - this.lastDrawnStart >= FLASH_SPACING_STEPS;",
    "new": "const draw = start - this.lastDrawnStart >= FLASH_SPACING_STEPS - 1;",
    "specs": [
      "src/engine/render/visual-rules.spec.ts",
      "src/app/shared/fireworks-stage/fireworks-stage.reduce-flashing.spec.ts"
    ]
  },
  {
    "id": "flash-spacing-floor",
    "name": "flash-spacing-floor",
    "file": "src/engine/render/visual-rules.ts",
    "old": "const FLASH_SPACING_STEPS = 41;",
    "new": "const FLASH_SPACING_STEPS = 40;",
    "specs": [
      "src/engine/render/visual-rules.spec.ts",
      "src/app/shared/fireworks-stage/fireworks-stage.reduce-flashing.spec.ts"
    ],
    "refreshed": "2026-11-15 (Toad T3): old text re-taken from the current source"
  },
  {
    "id": "flash-no-backward-reset",
    "name": "flash-no-backward-reset",
    "file": "src/engine/render/visual-rules.ts",
    "old": "if (simTime < this.lastSimTime) this.reset();",
    "new": "/* toad-mut */",
    "specs": [
      "src/engine/render/visual-rules.spec.ts",
      "src/app/shared/fireworks-stage/fireworks-stage.reduce-flashing.spec.ts"
    ]
  },
  {
    "id": "struct-builder-unwalked",
    "name": "struct-builder-unwalked",
    "file": "src/app/features/designer/designer-structure.spec.ts",
    "old": "const builder = walk(`${APP}/features/show`);",
    "new": "const builder: string[] = [];",
    "specs": [
      "src/app/features/designer/designer-structure.spec.ts"
    ]
  },
  {
    "id": "flash-spacing-40",
    "name": "flash-spacing-40",
    "file": "src/engine/render/visual-rules.ts",
    "old": "const FLASH_SPACING_STEPS = 41;",
    "new": "const FLASH_SPACING_STEPS = 40;",
    "specs": [
      "src/engine/render/visual-rules.spec.ts"
    ]
  },
  {
    "id": "m2-flash-spacing-39",
    "name": "flash-spacing-39",
    "file": "src/engine/render/visual-rules.ts",
    "old": "const FLASH_SPACING_STEPS = 41;",
    "new": "const FLASH_SPACING_STEPS = 39;",
    "specs": [
      "src/engine/render/visual-rules.spec.ts"
    ]
  },
  {
    "id": "move-same-step-too",
    "name": "move-same-step-too",
    "file": "src/app/features/show/shared/show-edit.ts",
    "old": "if (c.id !== id) return c;",
    "new": "if (c.id !== id && c.t !== show.cues.find((q) => q.id === id)?.t) return c;",
    "specs": [
      "src/app/features/show/pages/show-builder-page/show-builder.store.spec.ts"
    ]
  },
  {
    "id": "move-reseeds",
    "name": "move-reseeds",
    "file": "src/app/features/show/shared/show-edit.ts",
    "old": "const next: ShowCue = { ...c, ...patch };",
    "new": "const next: ShowCue = { ...c, ...patch, seed: c.seed ^ 1 };",
    "specs": [
      "src/app/features/show/pages/show-builder-page/show-builder.store.spec.ts"
    ]
  },
  {
    "id": "delete-same-step-too",
    "name": "delete-same-step-too",
    "file": "src/app/features/show/shared/show-edit.ts",
    "old": "return { ...show, cues: show.cues.filter((c) => c.id !== id) };",
    "new": "return { ...show, cues: show.cues.filter((c) => c.id !== id && c.t !== show.cues.find((q) => q.id === id)?.t) };",
    "specs": [
      "src/app/features/show/pages/show-builder-page/show-builder.store.spec.ts"
    ]
  },
  {
    "id": "share-c-path",
    "name": "share-c-path",
    "file": "src/app/features/show/pages/show-builder-page/show-save.ts",
    "old": "const link = `${location.origin}/s/${source.shareCode}`;",
    "new": "const link = `${location.origin}/c/${source.shareCode}`;",
    "specs": [
      "src/app/features/show/pages/show-builder-page/show-save.spec.ts"
    ]
  },
  {
    "id": "share-no-origin",
    "name": "share-no-origin",
    "file": "src/app/features/show/pages/show-builder-page/show-save.ts",
    "old": "const link = `${location.origin}/s/${source.shareCode}`;",
    "new": "const link = `/s/${source.shareCode}`;",
    "specs": [
      "src/app/features/show/pages/show-builder-page/show-save.spec.ts"
    ]
  },
  {
    "id": "share-toast-swap",
    "name": "share-toast-swap",
    "file": "src/app/features/show/pages/show-builder-page/show-save.ts",
    "old": "this.notifications.success(saved ? SHARE_COPIED : SHARE_COPIED_UNSAVED);",
    "new": "this.notifications.success(saved ? SHARE_COPIED_UNSAVED : SHARE_COPIED);",
    "specs": [
      "src/app/features/show/pages/show-builder-page/show-save.spec.ts"
    ]
  },
  {
    "id": "share-no-toast",
    "name": "share-no-toast",
    "file": "src/app/features/show/pages/show-builder-page/show-save.ts",
    "old": "this.notifications.success(saved ? SHARE_COPIED : SHARE_COPIED_UNSAVED);",
    "new": "/* toad-mut */",
    "specs": [
      "src/app/features/show/pages/show-builder-page/show-save.spec.ts"
    ]
  },
  {
    "id": "share-blocked-no-link",
    "name": "share-blocked-no-link",
    "file": "src/app/features/show/pages/show-builder-page/show-save.ts",
    "old": "this.blockedLink.set(link);\n      return",
    "new": "this.blockedLink.set(null);\n      return",
    "specs": [
      "src/app/features/show/pages/show-builder-page/show-save.spec.ts"
    ]
  },
  {
    "id": "more-same-page",
    "name": "more-same-page",
    "file": "src/app/features/show/pages/show-builder-page/show-library.ts",
    "old": "this.load(s.page + 1, s.items, 'more', done);",
    "new": "this.load(s.page, s.items, 'more', done);",
    "specs": [
      "src/app/features/show/pages/show-builder-page/show-save.spec.ts"
    ],
    "refreshed": "2026-11-15 (Toad T3): old text re-taken from the current source"
  },
  {
    "id": "more-replaces",
    "name": "more-replaces",
    "file": "src/app/features/show/pages/show-builder-page/show-library.ts",
    "old": "const all = [...items, ...fresh];",
    "new": "const all = [...fresh];",
    "specs": [
      "src/app/features/show/pages/show-builder-page/show-save.spec.ts"
    ]
  },
  {
    "id": "more-always",
    "name": "more-always",
    "file": "src/app/features/show/pages/show-builder-page/show-library.ts",
    "old": "if (s.status !== 'ready' || !s.more) return;",
    "new": "if (s.status !== 'ready') return;",
    "specs": [
      "src/app/features/show/pages/show-builder-page/show-save.spec.ts"
    ]
  },
  {
    "id": "strobe-all-shells",
    "name": "strobe-all-shells",
    "file": "src/app/features/player/pages/player-page/player-page.ts",
    "old": "strobe: [...used].some(",
    "new": "strobe: Object.keys(show.shells).some(",
    "specs": [
      "src/app/features/player/pages/player-page/player-page.show.spec.ts"
    ]
  },
  {
    "id": "field-undo-no-number",
    "name": "field-undo-no-number",
    "file": "src/app/features/show/pages/show-builder-page/show-builder-page.ts",
    "old": " input[type=\"number\"],",
    "new": " input[type=\"numberx\"],",
    "specs": [
      "src/app/features/show/pages/show-builder-page/show-builder-page.spec.ts"
    ]
  },
  {
    "id": "field-redo-hijacked",
    "name": "field-redo-hijacked",
    "file": "src/app/features/show/pages/show-builder-page/show-builder-page.ts",
    "old": "if (el?.closest(FORM_FIELDS)) return;",
    "new": "if (el?.closest(FORM_FIELDS) && !event.shiftKey) return;",
    "specs": [
      "src/app/features/show/pages/show-builder-page/show-builder-page.spec.ts"
    ],
    "refreshed": "2026-11-15 (Toad T3): old text re-taken from the current source"
  },
  {
    "id": "field-undo-meta-only",
    "name": "field-undo-meta-only",
    "file": "src/app/features/show/pages/show-builder-page/show-builder-page.ts",
    "old": "if (el?.closest(FORM_FIELDS)) return;",
    "new": "if (el?.closest(FORM_FIELDS) && event.metaKey) return;",
    "specs": [
      "src/app/features/show/pages/show-builder-page/show-builder-page.spec.ts"
    ],
    "refreshed": "2026-11-15 (Toad T3): old text re-taken from the current source"
  },
  {
    "id": "tree-store-session",
    "name": "tree-store-session",
    "file": "src/app/features/show/pages/show-builder-page/show-builder.store.ts",
    "append": "\nexport const __t = () => inject(SessionService);\n",
    "specs": [
      "src/app/features/designer/designer-structure.spec.ts"
    ]
  },
  {
    "id": "tree-store-fetch",
    "name": "tree-store-fetch",
    "file": "src/app/features/show/pages/show-builder-page/show-builder.store.ts",
    "append": "\nexport const __f = () => fetch('/api/creations');\n",
    "specs": [
      "src/app/features/designer/designer-structure.spec.ts"
    ]
  },
  {
    "id": "tree-edit-opencreation-import",
    "name": "tree-edit-opencreation-import",
    "file": "src/app/features/show/shared/show-edit.ts",
    "append": "\nimport { openCreation } from '../../../core/open-creation';\n",
    "specs": [
      "src/app/features/designer/designer-structure.spec.ts",
      "src/app/unsafe-sinks.spec.ts"
    ]
  },
  {
    "id": "tree-draft-opencreation-call",
    "name": "tree-draft-opencreation-call",
    "file": "src/app/features/show/shared/show-draft.ts",
    "append": "\nexport const __o = (c: any) => openCreation(c, 'x');\n",
    "specs": [
      "src/app/unsafe-sinks.spec.ts"
    ]
  },
  {
    "id": "tree-handoff-http",
    "name": "tree-handoff-http",
    "file": "src/app/features/show/shared/show-working-copy-handoff.ts",
    "append": "\nimport { HttpClient } from '@angular/common/http';\n",
    "specs": [
      "src/app/features/designer/designer-structure.spec.ts"
    ]
  },
  {
    "id": "tree-page-session",
    "name": "tree-page-session",
    "file": "src/app/features/show/pages/show-builder-page/show-builder-page.ts",
    "append": "\nimport { SessionService } from '../../../../core/session';\n",
    "specs": [
      "src/app/features/designer/designer-structure.spec.ts"
    ]
  },
  {
    "id": "tree-page-nav-name",
    "name": "tree-page-nav-name",
    "file": "src/app/features/show/pages/show-builder-page/show-builder-page.ts",
    "append": "\nexport const __n = (router: any, name: string) => router.navigateByUrl('/show?n=' + name);\n",
    "specs": [
      "src/app/unsafe-sinks.spec.ts"
    ]
  },
  {
    "id": "tree-page-nav-query",
    "name": "tree-page-nav-query",
    "file": "src/app/features/show/pages/show-builder-page/show-builder-page.ts",
    "append": "\nexport const __q = (router: any) => router.navigateByUrl('/show', { queryParams: { returnUrl: 'x' } });\n",
    "specs": [
      "src/app/unsafe-sinks.spec.ts"
    ]
  },
  {
    "id": "tree-html-href-name",
    "name": "tree-html-href-name",
    "file": "src/app/features/show/pages/show-builder-page/show-builder-page.html",
    "append": "\n<a [href]=\"'/s/' + store.show().name\">x</a>\n",
    "specs": [
      "src/app/unsafe-sinks.spec.ts"
    ]
  },
  {
    "id": "tree-html-innerhtml",
    "name": "tree-html-innerhtml",
    "file": "src/app/features/show/pages/show-builder-page/show-builder-page.html",
    "append": "\n<span [innerHtml]=\"store.show().name\"></span>\n",
    "specs": [
      "src/app/unsafe-sinks.spec.ts"
    ]
  },
  {
    "id": "tree-library-getbycode",
    "name": "tree-library-getbycode",
    "file": "src/app/features/show/pages/show-builder-page/show-library.ts",
    "append": "\nexport const __g = (c: any) => c.getByShareCode('x');\n",
    "specs": [
      "src/app/unsafe-sinks.spec.ts"
    ]
  }
],
};
