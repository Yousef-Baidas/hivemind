# Conventions

Every worker codes to `CONVENTIONS.md` at the repo root; every verifier checks the diff against it. Never assume taste. Missing file → interview before any ticket. The file is the human's; agents edit it only when the human says so.

## Interview (bootstrap, once)

1. Mid-project: spawn `hive-backend-worker` (Sonnet) with: "Draft `CONVENTIONS.md` from evidence only: linter and formatter configs, three representative source files per language, test file names, commit log style. Mark every rule `observed` or `guess`. No opinions." Blank repo: skip, all rules are open.
2. Ask the human, `AskUserQuestion`, in batches of at most four, only what the draft left as `guess` or open. Checklist:
   - naming: files, directories, variables, functions, types, constants, DB tables/columns, env vars, branch names
   - layout: feature folders vs layers, where tests live, barrel files yes/no, max file length
   - style: formatter and its config, semicolons/quotes/trailing commas or the language equivalent, import order, line width
   - errors: exceptions vs result types, logging library and levels, what is fatal
   - comments: when allowed, docstring style, TODO format
   - tests: runner, file naming, unit vs integration split, mocking policy, coverage floor
   - types: strictness flags, `any`-style escapes allowed or not, validation at boundaries
   - dependencies: who approves new ones, pinned or ranged, forbidden libraries
   - commits: scope names for Conventional Commits, PR size ceiling
   - anything the human wants forbidden outright
3. Write `CONVENTIONS.md`: one rule per line, grouped by the headings above, examples inline (`user_id` not `userId`). No prose, no rationale; the human owns the why. Commit `chore: add CONVENTIONS.md`.
4. Add to `AGENTS.md ## Learned`: "Code to CONVENTIONS.md. Verifier fails the ticket on a deviation."

## Enforcement

- Worker prompt (roles.md) reads `CONVENTIONS.md` second, after `PROFILE.md`. A rule in the file beats a rule in a skill.
- Verifier: any deviation is `BACK-TO-WORKER` with the rule quoted. Not a nit; a red.
- Lint config drifts from the file → stabilise ticket, not a silent edit.
- Human changes taste mid-run → they edit the file; the lead re-dispatches nothing already merged and notes the change in `## Learned`.
