# Ceremonies

## planning
- **When:** before (condition: a plan phase is about to start)
- **Facilitator:** Mario
- **Participants:** Peach, Yoshi, plus the phase's implementers (see the phase map in `CLAUDE.md`)
- **Purpose:** Turn the phase's section of `plans/initial-implementation.md` into briefs. Confirm acceptance criteria and name the code artifacts each review will read.

## design-review
- **When:** before (condition: the work involves UI or visual changes; Phases 2c, 5, 6 and 7 accessibility)
- **Facilitator:** Rosalina
- **Participants:** Luigi, Peach
- **Purpose:** Align on UX and the visual approach before implementation begins, with the prototype as the parity oracle.

## security-review
- **When:** before (condition: the work exposes API endpoints, handles identity or ownership, processes user input, or changes headers or the CSP; Phases 1, 4, 5, 7, 8)
- **Facilitator:** Boo
- **Participants:** Bowser, Mario (Luigi when the client handles the input)
- **Purpose:** Security review before shipping web-facing features.

## phase-gate
- **When:** after (condition: a phase's implementation is reported complete)
- **Facilitator:** Mario
- **Participants:** Toad, Peach
- **Purpose:** Check every "Done when" item against the code and a running app, not against the plan. Before the gate, `node tools/test/daily-status.mjs` must report a green daily or final run less than 24 h old (or Skyler's written acceptance of the failure); the gate itself runs the regular tier in Chromium. If work is rejected, a different agent revises it (strict lockout).

## retrospective
- **When:** manual (suggested after each phase-gate passes)
- **Facilitator:** Koopa
- **Participants:** Mario, Luigi, Bowser, Rosalina, Toad, Peach (Boo and Yoshi if they reviewed the phase)
- **Purpose:** Review completed work, surface friction, and record improvements in `docs/fireworks-app/retros/`.
