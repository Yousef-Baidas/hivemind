# Stack and worktrees

## Who loads what
| Tool | Lead | Worker | Verifier |
|---|---|---|---|
| graphify | once, unfamiliar repo | – | – |
| LSP plugin / Serena | – | yes | yes |
| ponytail | – | full | – |
| caveman | lite | full | lite |
| rtk + context-mode | yes | yes | yes |
| code-review-graph | – | – | yes |
| fallow (JS/TS) | `health` at close | `dead-code` on owned paths | `dupes` on diff |
| vulture / vulture-rs (Python) | close | `--min-confidence 80` owned paths | diff |
| ripgrep | yes | yes | yes |

Never two graph tools on one role. Workers get no repo tour; if one asks for context, fix the ticket. Missing tool → note once in the task list, continue.

## Context budget (200k lead)
Lead never reads worker code or diffs; the verifier does. Lead holds: skill, issue numbers, contracts, task list, one-line verdicts. Never a raw `gh issue view`; always `--json … -q`. If the lead passes ~120k, `/handoff` and restart the lead; workers and verifier are unaffected.

## Worktrees
```
git checkout -b hive/<run> main && git push -u origin hive/<run>
git worktree add ../<repo>-hive/<id> -b hive/<run>-<id> hive/<run>
git rev-parse hive/<run>   # fork point, record in task
```
Worker branches are `hive/<run>-<id>`, never `hive/<run>/<id>`: git cannot hold a ref and a ref-directory of the same name.
Per worktree: own dev-server port (`.env.local`), own DB/container/SQLite, own install dir. Shared services are why "passes alone, fails together".

Merge: `git worktree remove ../<repo>-hive/<id>` (the branch cannot be deleted while checked out), then `gh pr merge <pr> --merge --delete-branch`, then `git checkout hive/<run> && git pull` and the full suite. Every merge, not just the last.

More than ~6 parallel workers or multi-repo → hand worktree lifecycle to Composio Agent Orchestrator or Conductor; keep this skill for judgement.
