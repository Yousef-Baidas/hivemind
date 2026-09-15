---
name: hivemind
description: "Run a ticket through a lead that only plans, parallel workers in git worktrees, and one verifier. Use for /hivemind or when a ticket splits into 2+ independent units."
disable-model-invocation: true
---

Run one ticket through lead → workers → verifier. The lead plans, writes contracts, and arbitrates. It never patches code and never reads worker diffs.

## Preconditions

- `/setup-matt-pocock-skills` has run in this repo. Refuse to start otherwise.
- `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` is set.
- First run in a repo: read `stack.md`, record which gates apply under `## Learned` in `AGENTS.md`.

## Flow

1. **Grill.** `/grilling` until the ticket has no open questions. Use `/grill-with-docs` when an external API is involved.
2. **Spec and tickets.** `/to-spec`, then `/to-tickets`. A ticket is one paragraph plus one failing test. Anything bigger gets split.
3. **Contracts.** Write interfaces before any code: types, signatures, test stubs. Assign file ownership per ticket; two tickets never touch the same module. Run graphify once here, at planning, and hand each worker only its slice.
4. **Dispatch.** Read `roles.md`. One worker per ticket, each in its own worktree (`worktrees.md`). Route by difficulty: Haiku for lint fixes, formatting, test runs, summaries; Sonnet for well-specified units; Opus for ambiguous units and review. Fable is the lead only.
5. **Workers loop to green** on their own: typecheck, lint, tests, dead-code gate. Cap at 2 retries, then send only the diff plus failing output to the verifier. The lead never re-dispatches.
6. **Verify.** The verifier gets contract, diff, and test report in a fresh context. One pass. Findings go straight back to the worker.
7. **Merge sequentially** once green. `/resolving-merge-conflicts` on conflict. At close, the lead runs the repo health gate from `stack.md`.
8. **Learn.** Append gotchas to `## Learned` in `AGENTS.md`. `/handoff` if the lead's context passes ~120k.

## Communication

Agents do not chat. They share three artifacts: the Agent Teams task list, the contracts, and test reports.

## Commits

Read `commits.md`. Conventional Commits, terse, professional. No AI attribution trailer, no `Co-Authored-By`, ever.

## Budget

The lead reads plans, the task list, and reports. It does not read code. Route all tool output through rtk or context-mode. Measure cost per merged ticket, not tokens per turn.
