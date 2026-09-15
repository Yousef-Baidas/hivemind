---
name: hivemind
description: Ship a spec, PRD, or ticket set as a team of coding agents. Fable plans and arbitrates, Haiku/Sonnet/Opus workers build in isolated worktrees, one Opus verifier gates merges. Use whenever the user says hivemind, orchestrate, dispatch, swarm, or hands over work bigger than one agent should do alone.
disable-model-invocation: true
---

You are the lead. Four rules; break one and the bill explodes:

1. Lead plans, never patches. No feature code, no fix loops.
2. Verification lives in the worker. Types, lint, tests, dead-code green before it reports.
3. Agents talk to artifacts (tickets, contracts, test reports), never to each other.
4. Every ticket is a tracer bullet: one paragraph, one failing test, one owning module. Bigger → split.
5. No state in the repo. Tickets, milestones, reports, verdicts, reviews live in the tracker (`references/tracker.md`, GitHub today). The repo gets code, tests, contracts, `CONTEXT.md`, `CONVENTIONS.md`, `AGENTS.md`. Nothing else.

References, each read only when named: `bootstrap.md` and `tracker.md` at step 0, `conventions.md` when `CONVENTIONS.md` is missing, `teams.md` at step 2, `roles.md` when spawning, `review.md` at step 7½, `stack.md` on first run in a repo. Every agent that commits follows `references/commits.md`: Conventional Commits, terse, no AI attribution trailer, ever.

The human owns three things you never touch: `CONVENTIONS.md`, the skills list in `teams/*/skills.txt`, and the merge of `hive/<run>` into `main`. Every milestone stops at a human review; you do not continue past it on your own.

## Flow

0. **Bootstrap**: read `references/bootstrap.md`. Detect blank / mid-project / ready and take that path. It ends with `/setup-matt-pocock-skills` run, gates green on `main`, `CONTEXT.md`, `CONVENTIONS.md` (interviewed, never assumed), `AGENTS.md ## Learned`, and `teams/` with skills linked (`hive-scout` proposes, human approves). Not there → stop.
1. **Orient**: read `AGENTS.md`, `CONTEXT.md`, relevant ADRs. Unfamiliar repo → `graphify` once, keep the summary, never pass it to workers. Bigger than one session → `/wayfinder`. Otherwise `/grill-with-docs` unless already grilled.
2. **Tickets**: `/to-spec`, then `/to-tickets`; every ticket becomes a tracker issue, every milestone a tracker milestone, nothing written to disk. Then enforce: one file owner per ticket, hotspot files (routes, registries, config, barrels) in a ticket that runs first, difficulty tag `routine|standard|hard`, profile tag `frontend|backend|devops` per `references/teams.md`. Two profiles in one ticket → two tickets with a contract between them. Group tickets into milestones, one user-visible feature each, per `references/review.md`; a single-ticket run is one milestone.
3. **Contracts**: per ticket, commit the exported signatures and a red test stub. Use `/codebase-design` vocabulary. Can't write the contract → `/grilling` until you can.
4. **Dispatch**: Agent Teams, one worktree per ticket, one PR per ticket into `hive/<run>`. Spawn `hive-<profile>-worker`; name the model in the spawn prompt: `routine`→Haiku, `standard`→Sonnet, `hard`→Opus. Worker gets the issue number + contract pointers + owned paths only. Worker runs `/implement`; retry cap 2; reports as issue comments. Then you watch the task list (runtime mirror of the tracker) and nothing else.
5. **Escalate** one rung, never restart: (a) same worker, failing output pasted back, mechanical failures only; (b) diff + red output to the next model up, not the ticket; (c) two Opus fails → the contract is wrong, back to step 3 as a fresh task.
6. **Verify**: `hive-<profile>-verifier`, fresh context, gets ticket + contract + diff + test report. Runs `/code-review`, blast radius, dead-code. Ticket touches auth, input, secrets, file or network I/O → `hive-security-verifier` as a second verifier; both must say `MERGE`. Verdict `MERGE | BACK-TO-WORKER (numbered) | CONTRACT-WRONG` as a PR review. Back-to-worker goes direct, one round, then it's contract-wrong.
7. **Merge** PRs sequentially in dependency order into `hive/<run>`, full suite after each, close the issue. Conflicts → `/resolving-merge-conflicts`. Wave merged → `hive-qa-verifier` once on the branch; `WAVE-RED` failures become tickets, not fixes.
7½. **Human review**: milestone complete and `WAVE-GREEN` → read `references/review.md`. Spawn `hive-guide`; it opens the review issue with brief and evidence. Notify, point the human at `/hivemind-review` in a second terminal, then poll the issue for a verdict comment in a background shell. You never relay the review. `ACCEPT` → next milestone. `CHANGES` → tickets, step 3, same gate again. Human says they are away → print the unattended warning from `review.md`, continue only on the literal `UNATTENDED`; then the guide self-verifies with evidence and queues the milestone for later review.
8. **Close**: last milestone accepted. Full suite + `fallow health` (JS/TS) or `vulture` (Python) on the integration branch. Append repeated corrections to `AGENTS.md` under "Learned". Open the PR from `hive/<run>` to `main` linking the milestones; the human merges. Delete `hive-evidence/<run>` after. Session ending with open work → `/handoff`. Report cost per merged ticket.
