# Bootstrap

Run before step 1 of the flow, every time. Detect the repo state, then take the matching path. Never skip the checks; a missing gate is how a wave passes locally and fails on merge.

## Detect

| Signal | State |
|---|---|
| no `.git`, or `git log` empty, or no source files | **blank** |
| source files, no `CONTEXT.md` or no `AGENTS.md ## Learned` | **mid-project, unset** |
| `CONTEXT.md` + `AGENTS.md ## Learned` + gates green | **ready** — go to flow step 1 |

## Blank

1. `git init`, initial commit of an empty `README.md`, branch `main`.
2. `/grilling` on the idea until stack, runtime, and package manager are decided. Do not scaffold before this.
3. `/setup-matt-pocock-skills`. Write `CONTEXT.md` via `/domain-modeling` with the first ten terms.
4. First ticket, always alone, always `hard`: **scaffold**. Package manifest, typecheck, lint, test runner, one passing smoke test, the gate commands from `stack.md` for the language, and the mechanical gates from `references/enforcement.md`: `.github/workflows/hive-gates.yml`, `lefthook.yml`, `.claude/hooks/commit-msg.js`, `EDIT` lines filled from the gate commands. Nothing else. Merge it before any feature wave.
5. Add `## Learned` to `AGENTS.md`. Record the gate commands there.
6. Now the flow from step 1. Hotspot files (routes, registries, config, barrels) get their own ticket in wave one.

## Mid-project, unset

1. `/setup-matt-pocock-skills` if not run. `/domain-modeling` for `CONTEXT.md` if missing; `/wayfinder` first if the repo is large enough that one session cannot hold it.
2. Run every gate from `stack.md` on `main`. Red gates go into a **stabilise** ticket that runs alone before any feature wave; the same ticket installs the CI workflow, lefthook, and commit-msg check from `references/enforcement.md` if the repo lacks them. Do not dispatch features onto a red baseline; workers cannot tell their red from yours.
3. `fallow health` / `vulture` on the repo. Dead code and duplicates go into the same stabilise ticket or a follow-up, never into a feature ticket.
4. Add `## Learned` to `AGENTS.md`. Record: gate commands, package manager, test layout, the modules that are hotspots.
5. Existing branches or worktrees: list them, ask the user which are live, leave the rest alone. Never delete a branch you did not create.
6. Now the flow from step 1.

## Conventions (both paths)

`CONVENTIONS.md` missing → read `references/conventions.md`, run the interview, commit the file. Never start a ticket on assumed taste.

## Teams folder (both paths)

`teams/<profile>/PROFILE.md` must exist for every profile the run will tag. Missing → tell the user to run `install.sh --project` from the hivemind checkout and stop. Do not read the `PROFILE.md` files yourself; `ls teams/` is enough. `teams/templates/` must exist too; it holds the CI, lefthook, and hook templates.

Skills: if any `teams/<profile>/skills.txt` is still the shipped default (header says so) or the human says "refresh skills", spawn `hive-scout`. It reads the stack and rewrites the lists from skills.sh ranked by installs. Print its report, ask the human to approve, then the human runs `bash teams/link-skills.sh --install --confine` (`.\teams\link-skills.ps1 -Install -Confine` on Windows). Third-party skill text runs inside every worker; the human decides what gets in. The script writes `teams/skills-lock.json`; commit it. `drift: <skill>` in its output means this machine's copy differs from the lock; `npx skills update <skill>` or `--relock` (`enforcement.md` §6).

## Tracker (both paths)

Read `references/tracker.md`. Run its preflight; no remote or no auth → stop, tell the human. Create the labels once. Blank repo: `gh repo create` is the human's call; ask, do not assume public/private. Nothing hivemind produces during a run is written to the repo except code, tests, contracts, and the three docs.

## Ready

Confirm in one line: gates green on `main`, `CONTEXT.md`, `CONVENTIONS.md`, `## Learned`, `teams/` with links, tracker reachable. Go.
