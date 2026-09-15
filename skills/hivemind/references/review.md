# Human review gate

Agents verify tickets; the human verifies milestones. The loop halts at every gate until a verdict exists. One ticket is one milestone; no run is too small.

The lead never talks the human through a review. It has no diff, and every relayed line costs it twice. The human talks to the **review session** instead, or to a file.

## Milestones

At step 2, after `/to-tickets`, group tickets into milestones: one user-visible feature or one stated task each. Task list: `MILESTONE <n>: <name> — <ticket ids>`. Dependency order.

## Gate

Fires after the last ticket of a milestone merges into `hive/<run>` and QA says `WAVE-GREEN`. `<id>` = `<run>-<milestone>`.

1. Spawn `hive-guide` with run, milestone, ticket ids and intents, diff range, QA verdict, gate commands. It writes `.hive/reviews/<id>.md` (brief) and `.hive/reviews/<id>/evidence/` (screenshots, transcripts), commits the brief, exits.
2. `PushNotification`: `review ready: <milestone> — .hive/reviews/<id>.md`. Print two lines to the terminal: the brief's path, and `claude → /hivemind-review` in a second terminal (or `/remote-control` from the phone).
3. Wait: `Bash run_in_background` with `until [ -s .hive/reviews/<id>.verdict ]; do sleep 20; done`. Dispatch nothing. Your context sits idle; that is the point.
4. Verdict file, first line:
   - `ACCEPT` → `git tag review/<id>`, next milestone. Last one → step 8.
   - `CHANGES` → every following line is a ticket via step 2 (contract, red test, profile, difficulty), one wave, milestone `<name>-r2`. Back to step 3; the gate fires again.
   - anything else → treat as no verdict, keep waiting, print once "verdict file needs ACCEPT or CHANGES on line 1".

## Channels

Any of these produce the verdict file; the lead does not care which.

| Channel | How |
|---|---|
| review session | second terminal, `claude`, `/hivemind-review`. Fresh Sonnet session with the brief, the diff, and the evidence; chats, runs steps on request, writes the verdict when told. Zero lead tokens. |
| phone | `/remote-control` on the review session; same chat from claude.ai. |
| file only | read `.hive/reviews/<id>.md`, write `ACCEPT` or `CHANGES` + lines into `.hive/reviews/<id>.verdict`. No AI involved. |
| evidence only | open `.hive/reviews/<id>/evidence/` (screenshots, recordings, transcripts) then write the file. Good for UI work reviewed on a phone. |

## Unattended

The human may say so in words: "going to sleep", "away until 9", "don't wait for me", "unattended". Before honouring it, print this, plain, once:

> **Unattended mode.** Human review gates will be auto-accepted. What you lose: nobody checks that the feature is the feature you meant, only that it is green and consistent. Wrong assumptions compound across milestones; a bad contract in milestone 1 ships into milestone 4. Every auto-accepted milestone is queued for your review with evidence, nothing merges into `main`, and any worker `NEEDS` question parks its ticket instead of guessing. Reply `UNATTENDED` (optionally `until <time>` or `for <n> milestones`) to confirm, or anything else to stay attended.

Only the literal word confirms. Then, per gate:

1. Guide runs as usual **plus** executes its own verify steps: Playwright MCP or `playwright-cli` screenshots per step where a UI exists, CLI transcripts otherwise, into `evidence/`. A step it cannot execute is listed under `## Not verified`.
2. Guide writes the verdict itself: `AUTO-ACCEPT` if every executed step matched and `## Not verified` is empty; else `AUTO-HOLD` with the reasons. Lead: `AUTO-ACCEPT` → tag `review/<id>/auto`, continue. `AUTO-HOLD` → treat as open review; stop there; `PushNotification`; wait.
3. Append `<id>` to `.hive/reviews/QUEUE`. When unattended ends (time, count, or the human speaks), print the queue and stop; nothing further dispatches until each queued id has a human `ACCEPT` or `CHANGES` via `/hivemind-review`. Retroactive `CHANGES` become tickets like any other.
4. Never in unattended mode: merge into `main`, approve a new dependency, install a skill, rewrite `CONVENTIONS.md`, escalate past two Opus fails (park as `CONTRACT-WRONG`, continue with independent tickets).
5. Hard stop: token budget or milestone count if given; otherwise stop after the queue reaches 5 unreviewed milestones. `PushNotification` on stop.

## What the human owns

Merging `hive/<run>` into `main`; `CONVENTIONS.md`; the skills list; every `NEEDS <dependency>`; every review verdict, eventually, even the auto-accepted ones.
