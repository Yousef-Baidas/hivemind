# Human review gate

Agents verify tickets; the human verifies milestones. The loop halts at every gate until a verdict exists. One ticket is one milestone; no run is too small.

The lead never talks the human through a review. It has no diff, and every relayed line costs it twice. The human talks to the **review session** or to the review issue.

## Milestones

At step 2, after `/to-tickets`, one tracker milestone per user-visible feature or stated task, `<run>/<name>`. Tickets belong to exactly one. Dependency order.

## Gate

Fires after the last ticket of a milestone merges into `hive/<run>` and QA says `WAVE-GREEN`.

1. Spawn `hive-guide` with run, milestone, ticket numbers, diff range, QA verdict, gate commands, mode. It opens the review issue `Review: <run>/<milestone>` (label `hive-review`, `needs-human`) with the brief and evidence links, exits.
2. `PushNotification`: `review ready: <milestone> — <issue url>`. Print the url and `HIVEMIND=0 claude → /hivemind-review` in a second terminal (or `/remote-control` from the phone).
3. Wait: `Bash run_in_background`, the poll from `tracker.md`, until a verdict comment exists. Dispatch nothing. Idle context costs nothing.
4. Verdict comment, first line:
   - `ACCEPT` → remove `needs-human`, close review issue and milestone, next milestone. Last one → step 8.
   - `CHANGES` → every following line is a ticket via step 2 (contract, red test, profile, difficulty), one wave, milestone `<name>-r2`. Back to step 3; the gate fires again.
   - anything else is not a verdict; keep waiting.

## Channels

Any of these produce the verdict comment; the lead does not care which.

| Channel | How |
|---|---|
| review session | second terminal, `HIVEMIND=0 claude --model sonnet`, `/hivemind-review` (`HIVEMIND=0` keeps the lead autostart and guard out of it). Fresh session with the issue, the diff, and the evidence; chats, runs steps on request, posts the verdict when told. Zero lead tokens. |
| phone | `/remote-control` on the review session, or the GitHub app: read the issue, comment `ACCEPT`. |
| issue only | read the brief on GitHub, comment `ACCEPT` or `CHANGES` + lines. No AI involved. |
| evidence only | open the linked screenshots, then comment. |

## Unattended

The human may say so in words: "going to sleep", "away until 9", "don't wait for me", "unattended". Before honouring it, print this, plain, once:

> **Unattended mode.** Human review gates will be auto-accepted. What you lose: nobody checks that the feature is the feature you meant, only that it is green and consistent. Wrong assumptions compound across milestones; a bad contract in milestone 1 ships into milestone 4. Every auto-accepted milestone stays labelled `needs-human` with evidence, nothing merges into `main`, and any worker `NEEDS` question parks its ticket instead of guessing. Reply `UNATTENDED` (optionally `until <time>` or `for <n> milestones`) to confirm, or anything else to stay attended.

Only the literal word confirms. Then, per gate:

1. Guide runs as usual **plus** executes its own verify steps: Playwright MCP or `playwright-cli` screenshots per step where a UI exists, CLI transcripts otherwise. A step it cannot execute goes under `## Not verified`.
2. Guide comments the verdict itself: `AUTO-ACCEPT` if every executed step matched and `## Not verified` is empty; else `AUTO-HOLD` with reasons. Lead: `AUTO-ACCEPT` → close the milestone, keep `needs-human`, continue. `AUTO-HOLD` → open review; stop; `PushNotification`; wait.
3. When unattended ends (time, count, or the human speaks): list `gh issue list --label needs-human` and stop; nothing dispatches until each has a human `ACCEPT` or `CHANGES` via `/hivemind-review`. Retroactive `CHANGES` become tickets like any other.
4. Never in unattended mode: merge into `main`, approve a new dependency, install a skill, rewrite `CONVENTIONS.md`, escalate past two Opus fails (park as `CONTRACT-WRONG`, continue with independent tickets).
5. Hard stop: token budget or milestone count if given; otherwise at 5 open `needs-human` issues. `PushNotification` on stop.

## What the human owns

Merging `hive/<run>` into `main`; `CONVENTIONS.md`; the skills list; every `NEEDS <dependency>`; every review verdict, eventually, even the auto-accepted ones.
