# Session log: end-of-project review batch (2026-11-17)

- **Ran:** Toad (four runs), Yoshi (CPU-cost review), Bowser (`WarmUpDelayMs`), Luigi (three runs). Coordinator ran the regular tier and the commit. Orchestration entries: `.squad/orchestration-log/2026-11-17T215052Z-{Toad,Yoshi,Bowser,Luigi}.md`.
- **Outcome:** Final tier PASS 75/75 (32.4 min). Governor trigger did not fire. Regular tier PASS in 212.5 s (`test-results/regular/2026-11-17T164643`). Committed by the coordinator as `752bf2e`. Scribe did not commit.
- **Records check:** all six present in `.squad/decisions/records/`: `toad-final-tier-run.md`, `yoshi-end-review-cpu-cost.md`, `bowser-end-review-warmup-delay.md`, `toad-end-review-followups.md`, `luigi-end-review-cpu-fixes.md`, `toad-end-review-verification.md`. Rulings are in the plan status line; index rows 90 to 92 were added 2026-11-17.
- **Supersession marks (in place, nothing merged or deleted):**
  - `toad-redundant-spec-deletion.md`: the open T21 and T23 item is superseded in part by `toad-end-review-followups.md` (T21 killed, T23 equivalent). T27 and T40 stand.
  - `yoshi-end-review-cpu-cost.md`: option C's skip threshold is superseded in part by `luigi-end-review-cpu-fixes.md` (200 ms). Option B and the render and upload rules stand.
- **Cross-agent notes (`## Learnings`):**
  - Toad: Luigi's `startApi` finding (in-process OAuth stub; use async `spawn`, not `spawnSync`).
  - Rosalina: Luigi's router first-render boundary rule.
  - Yoshi: option C changed; the probe under-predicts about 4×.
- **History folds (over 12,288 bytes, folded into Core Context):**
  - Toad 17,962 to 12,049 bytes. Under the limit but within 300 bytes, so the next append needs a fold.
  - Luigi 15,824 to 11,330 bytes.
  - Yoshi 12,724 to 10,136 bytes (after its note).
  - Rosalina 9,774 bytes after its note; no fold needed.
- **Index check (`.squad/decisions/README.md`, not edited):**
  1. **Contradiction, flagged to Skyler:** row 92 (end-review CPU rulings) says warm-up is skipped when the predicted cold run is ≤ 1 s. The verification ruling is 200 ms, and no index row carries it. Update row 92 or promote the verification rulings.
  2. **Not indexed, flagged:** the verification rulings (700 then 200 ms; T23 check removed; Reduce flashing first-render fix; hand-fused upload not built; T27 and T40 declined; governor not fired) live only in the plan status line. Promotion is Skyler's call.
  3. **Consistent, noted:** row 84 (no fps-driven quality; governor only on its trigger); row 85 (strict CSP, no `unsafe-eval`, the polyfill runs without eval); row 85 ("background warm-up ships", still true, but shows at or under 200 ms predicted skip it); row 86 (Chromium-only regular runs).
- **Carried open items:**
  - T27 and T40 engine-spec gaps (Skyler declined for now).
  - Density-aware warm-up prediction (possible later work).
  - Hand-fused upload (not built; waits for its trigger).
  - N1 (`signedInWith` typing; Luigi). N2 (stale `src/api/Fireworks.Api/bin/Release/net11.0/appsettings.json`; Bowser's area). A37 (DataProtection keys stored unencrypted in Postgres; residual accepted with triggers, `boo-phase8-security-requirements.md`).
  - Railway deploy and its [R] items (deferred per Q7.1).
  - G2 has no spec (sign-out keeps the draft bytes; Skyler decides whether it becomes a gate).
  - Five stale wait-loop processes the user was asked to kill. Scribe did not kill them. At logging time, `sleep` children from wait loops started 4:50 PM were still running.
- **Commits:** none by Scribe. Logs are uncommitted.
