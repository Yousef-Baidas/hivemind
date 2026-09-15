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
4. First ticket, always alone, always `hard`: **scaffold**. Package manifest, typecheck, lint, test runner, one passing smoke test, and the gate commands from `stack.md` for the language. Nothing else. Merge it before any feature wave.
5. Add `## Learned` to `AGENTS.md`. Record the gate commands there.
6. Now the flow from step 1. Hotspot files (routes, registries, config, barrels) get their own ticket in wave one.

## Mid-project, unset

1. `/setup-matt-pocock-skills` if not run. `/domain-modeling` for `CONTEXT.md` if missing; `/wayfinder` first if the repo is large enough that one session cannot hold it.
2. Run every gate from `stack.md` on `main`. Red gates go into a **stabilise** ticket that runs alone before any feature wave. Do not dispatch features onto a red baseline; workers cannot tell their red from yours.
3. `fallow health` / `vulture` on the repo. Dead code and duplicates go into the same stabilise ticket or a follow-up, never into a feature ticket.
4. Add `## Learned` to `AGENTS.md`. Record: gate commands, package manager, test layout, the modules that are hotspots.
5. Existing branches or worktrees: list them, ask the user which are live, leave the rest alone. Never delete a branch you did not create.
6. Now the flow from step 1.

## Ready

Confirm in one line: gates green on `main`, `CONTEXT.md` present, `## Learned` present. Go.
