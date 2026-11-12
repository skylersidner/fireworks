# Skill: Review Brief Surfaces

**Domain:** Review briefs, design review, acceptance, security review
**Applies to:** Any brief asking someone to review a design, a phase plan or a change
**Confidence:** medium. Carried over from a previous project, where the surfaces were measured; the default surfaces here are adapted to this app's layout.

---

## The line that goes in the brief

> **Check the payload, not just the entity. Design documents describe entities; contracts describe payloads, and that's where the gaps are.**

**The verb matters more than the noun.** Name the file *and* the claim it has to settle:

- ❌ `Review the save flow.`
- ❌ `Read core/models.ts.`
- ✅ `Read Contracts/CreationContracts.cs and confirm UpdateCreationRequest can express everything "Save" sends from the designer.`

A reviewer told to read a file will read it. A reviewer told what the file has to prove will *interrogate* it.

---

## Default surfaces for this project

Start here, then add feature-specific ones.

| # | Surface | Holds | Typical reviewer |
|---|---|---|---|
| 1 | `src/api/Fireworks.Api/Contracts/*`, **specifically the request records** | What the API will actually *accept* | Bowser, Boo |
| 2 | `src/web/fireworks-web/src/app/core/models.ts` | What the client believes the API *returns* | Peach |
| 3 | `engine/model/limits.ts`, `CreationLimits.cs` and `schema/fixtures/` | Whether client and server agree on what's valid | Toad, Yoshi |
| 4 | **The file the feature writes into most, and the templates that read it** (for example `ShellDesignerStore` and the designer templates) | The existing invariants the new design has to live with | Luigi |
| 5 | A running repro (the app, the `.http` file, two browsers) | Timing, ordering, concurrency and rendering, which reading can't reach | Toad |

**Row 4 is chosen by what the feature writes into, not by file size.** Take it from the phase's file list in the plan. A state file and its readers are one surface, so include the templates.

---

## The failure signal

**Every review finding names the surface that produced it,** as one parenthetical per finding. If no finding in a report names a code surface, the brief sent the reviewer back to the documents and failed. Drop surfaces that never appear, and add ones that keep turning up unprompted.

## What this does not do

Naming a file makes a reviewer open it; it doesn't make them ask a question the file answers. Briefs whose deliverable is a *claim about behavior* (acceptance criteria, security findings) get this effect for free. Briefs that ask for an *opinion about a design* don't. If a review produces nothing, the missing ingredient is more likely the question than the file list.

Decision: `.squad/decisions/README.md` §1. Record: `records/koopa-review-briefs-name-a-code-artifact.md`.
