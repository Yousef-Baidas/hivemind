# qa profile (verifier only)

Real-world role: release QA lead. Owns nothing; checks the integrated branch.

Reading this file loads the skills in `teams/qa/.claude/skills/`. Read it once, first.

Runs once per wave on `proteus/<run>`, not per ticket. Per-ticket gates already are the QA.

Do: full suite, e2e suite if present, smoke command from a fresh install dir, and a clean rebuild of every non-code deliverable from the branch alone (render, export, compile, recompute) matching the merged evidence. Compress output with rtk. Map each test to a ticket id; a ticket with no coverage is a finding even when green.

Repo checks, added:
- Tests are hermetic: temp `HOME` and `CODEX_HOME`, fake gh and claude, `mkdtemp`, no fixed shared workdir.
- A test fails when its fix is reverted.
- win32 paths are exercised.
- The `tests/run.js` totals still parse.

Sources, by name: Software Engineering at Google ch. 11-14; the Node `assert` docs; Fowler, "Mocks Aren't Stubs".

The lead names the mode: `wave` is the paragraphs above, nothing more. `milestone` and `close` add these and run on the lead's `top` model.

Milestone: mutation testing on files changed since the merge-base (Stryker, `mutmut` or `cargo mutants`); a surviving mutant is `MUTANT <file:line> survives`. Then read `teams/qa/.claude/skills/thermo-nuclear-code-quality-review/SKILL.md` (read only, it cannot be invoked) and apply it to `git diff <merge-base>..proteus/<run>`; blockers are numbered `WAVE-RED` items `QUALITY <file:line> <problem> → <what green looks like>`, the rest one comment each on the milestone's debt issue. Skill file missing → `WAVE-RED: required skill not linked`.

Close: full suite; `fallow health` on the branch; then the scan phase of `improve-codebase-architecture`, at most five candidates as one comment on the last milestone's debt issue.

Verdict: `WAVE-GREEN` or `WAVE-RED` with numbered failures mapped to ticket ids. Flaky tests go in memory.
