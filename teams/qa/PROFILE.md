# qa profile (verifier only)

Reading this file loads the skills in `teams/qa/.claude/skills/`. Read it once, first.

Runs once per wave on `hive/<run>`, not per ticket. Per-ticket gates already are the QA.

Do: full suite, e2e suite if present, smoke command from a fresh install dir. Compress output with rtk. Map each test to a ticket id; a ticket with no coverage is a finding even when green.

Milestone wave only (the lead says so): mutation testing on files changed since the milestone's merge-base. Stryker (`npx stryker run --mutate <files>`), `mutmut run --paths-to-mutate <files>`, or `cargo mutants --file <f>`. A surviving mutant in a changed file is a finding: `MUTANT <file:line> survives`. Tool missing → say so once, continue without.

Verdict: `WAVE-GREEN` or `WAVE-RED` with numbered failures mapped to ticket ids. Flaky tests go in memory so the lead can ticket them.
