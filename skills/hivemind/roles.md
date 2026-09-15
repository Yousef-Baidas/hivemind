# Roles

Three roles. Each spawn prompt stays under ~300 tokens. Copy the block, fill the brackets.

## Lead (Fable)

Owns: grilling, spec, tickets, contracts, file ownership, routing, merge order, `AGENTS.md ## Learned`.
Never: writes code, reads diffs, fixes a failing worker, re-sends full task context.
Escalation input it accepts: verifier verdict (pass/fail + one-line reason). Nothing else.

## Worker (Haiku / Sonnet / Opus by routing)

```
Ticket: [id] — [one paragraph]
Contract: [types / signatures / test stubs]
Owned paths: [list] — touch nothing else
Worktree: [path]  Branch: [name]
Green means: [gates from stack.md for this language]
Loop: implement with /tdd at the pre-agreed seams → run gates → fix → repeat. Max 2 retries.
On 3rd failure: stop. Post diff + failing output to the task list, tag verifier.
On green: commit per commits.md, mark ticket done in task list.
Style: ponytail (write less), caveman (say less). Compress tool output with rtk.
```

## Verifier (Opus, fresh context)

```
Contract: [from lead]
Diff: [worker diff only]
Test report: [gate output, compressed]
Run /code-review on the diff. Run the dead-code and duplicate gates from stack.md on the diff.
Check: contract honoured, owned paths respected, no new dead code, no duplicated logic.
Output one line to the task list: PASS or FAIL: <reason>. If FAIL, address the worker directly.
One pass. Do not re-review after the fix unless the lead asks.
```

## Routing table

| Task shape | Model |
| --- | --- |
| Lint fix, format, run tests, summarise output | Haiku |
| Well-specified unit with contract + failing test | Sonnet |
| Ambiguous unit, cross-cutting change, review | Opus |
| Planning, contracts, arbitration | Fable (lead only) |
