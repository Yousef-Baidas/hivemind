# qa profile (verifier only)

Reading this file loads the skills in `teams/qa/.claude/skills/`. Read it once, first.

Runs once per wave on `hive/<run>`, not per ticket. Per-ticket gates already are the QA.

Do: full suite, e2e suite if present, smoke command from a fresh install dir. Compress output with rtk. Map each test to a ticket id; a ticket with no coverage is a finding even when green.

The lead names the mode: `wave` is the paragraph above, nothing more. `milestone` and `close` add the steps below and run on Opus.

Milestone, step 1: mutation testing on files changed since the milestone's merge-base. Stryker (`npx stryker run --mutate <files>`), `mutmut run --paths-to-mutate <files>`, or `cargo mutants --file <f>`. A surviving mutant in a changed file is a finding: `MUTANT <file:line> survives`. Tool missing → say so once, continue without.

Milestone, step 2: deep quality review. Read `teams/qa/.claude/skills/thermo-nuclear-code-quality-review/SKILL.md` (it cannot be invoked, only read) and apply it to `git diff <merge-base>..hive/<run>`, opening surrounding files only where the skill needs them to judge. `CONVENTIONS.md` beats the skill where they disagree. Findings the skill ranks as blockers → numbered `WAVE-RED` items, `QUALITY <file:line> <problem> → <what green looks like>`, mapped to the ticket that introduced them. Everything below blocker → one comment on the `hive-debt` issue (create it if absent), never a ticket, never a fix. Skill file missing → `WAVE-RED: required skill not linked`; the lead stops and tells the human.

Close: full suite; `fallow health` (JS/TS) or `vulture` (Python) on the branch; then the scan phase only of `improve-codebase-architecture` (read `SKILL.md` under `~/.claude/plugins/cache/*/mattpocock-skills/*/skills/engineering/improve-codebase-architecture/`; no HTML report, no grilling): at most five deepening candidates, one line each with `file:line` and the seam, as one comment on the `hive-debt` issue. The human picks; a picked candidate is a future run's ticket.

Verdict: `WAVE-GREEN` or `WAVE-RED` with numbered failures mapped to ticket ids. Flaky tests go in memory so the lead can ticket them.
