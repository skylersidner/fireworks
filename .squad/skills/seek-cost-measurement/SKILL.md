---
name: seek-cost-measurement
description: Measuring TimelineDriver seek and step cost (wall time, not fps) in node and Chrome, on the dev and production builds, cold and warm. Use for caps questions, the >1 s seek trigger, warm-up acceptance, and the end-of-project CPU review.
---

# Seek cost measurement

1. **Report cold and warm separately.** Cold = a saved show freshly opened at `/c/<code>`, then 20 seeded random scrubs; warm = the same after one full pass. The first far-forward seek past the played region is a full run (no checkpoints), so cold p95 ≈ the longest forward run.
2. **Model caps without editing the product:** bundle the engine with the repo's esbuild and build `new FireworksSim({ capacity, starBudget: 1 })` + `TimelineDriver` + `EngineLoop({ worldWidth, driver })`. Count drops by wrapping `sim.particles.spawn` on the instance in a separate, untimed pass.
3. **Production build has no `ng` global.** Stub `GET api/client-config` with `page.route` (defaults, but `catchingUpDelayMs: 0`) so "Catching up…" (`data-testid="catching-up"`) marks every multi-frame seek; arrival = its removal (±1 frame). On dev, poll `ng.getComponent(stage).seeking()` per rAF and cross-check.
4. **Drive the seek from the scrub input** (`data-testid="scrub"`, set `value`, dispatch `input` then `change`); for Play, focus the button and press Enter.
5. **Quote long tasks from the production build** (the API on 5180 serves `wwwroot`; check its mtime against the sources). The dev build shows ~100× more long tasks on a max seek.
6. **Record `uptime` with every run**; parallel agents push load to 5–11 here. Expect ±20 %.
7. **Writes:** save via `POST /api/creations`, space them, DELETE afterwards and confirm 404. A 600k-capacity "demand" pass on `at-maximums` takes 10+ minutes; skip it for worst cases.

Reference run and scripts: `.squad/decisions/records/toad-phase7-caps-and-seek.md`.
