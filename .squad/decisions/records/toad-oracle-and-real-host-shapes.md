# Regression checks need an oracle, and test hosts bind exactly what real call sites bind
**By:** Toad (QA Tester)

> **Carried over** on 2026-11-12 from monster-of-the-week-net-angular, generalized. The evidence that produced the lesson was in that project; the rule is what carries over.

## What
1. **When proving that a shared component's existing uses didn't change, compare against a re-implementation of the previous behavior** (a pure function that encodes the old rules), not a hand-written expectation.
2. **A test host binds exactly the inputs its real call site binds, no more.** A single host that binds every input with fallbacks supplies the defaults itself instead of exercising them. Use one host per real binding shape.
3. **Drive interactions from where the user actually is.** For focus and keyboard tests, press the key from the element that really has focus. Pressing from a convenient element can leave focus where the assertion expects it whether or not the handler works.

## Why
In each case the test and the code agreed because both came from the same mental model, so the assertion couldn't fail for the reason it existed. A cheap mutant exposed each one.

## Mutant hygiene (C#)
After restoring a mutated file, **update its timestamp**. A copy-restore can leave the file older than the assembly built from the mutant; MSBuild then skips the rebuild and the next `dotnet test` runs the mutant. A byte comparison passes and proves nothing about the build.

## Applies here
The shared `range-row` and `select-row` controls are used across every designer field group, and the Space-to-launch handler must ignore keypresses that come from form fields.
