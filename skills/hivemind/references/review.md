# Human review gate

Agents verify tickets; the human verifies milestones. The loop halts at every gate until the human says so. No exception for "small" runs: one ticket is one milestone.

## Milestones

At step 2, after `/to-tickets`, group tickets into milestones: one user-visible feature or one stated task each. Write them to the task list as `MILESTONE <n>: <name> — <ticket ids>`. Order by dependency. A run from a single ticket is one milestone.

## Gate

Fires after the last ticket of a milestone merges into `hive/<run>` and `hive-qa-verifier` says `WAVE-GREEN`.

1. Spawn `hive-guide` with: run, milestone name, ticket ids and intents, diff range (`<merge-base>..hive/<run>`), QA verdict, gate commands from `## Learned`. It writes `.hive/reviews/<run>-<milestone>.md`.
2. Print that file to the human verbatim. Then stop. Dispatch nothing. Say only: "Review <milestone> when ready."
3. Human asks a question → forward it to the guide by message, relay the answer verbatim. You do not answer from memory; the guide has the diff, you do not.
4. Human replies `ACCEPT` → tag `hive/<run>` with `review/<milestone>`, next milestone. Last milestone → step 8.
5. Human replies `CHANGES: …` → each line becomes a ticket via step 2 (contract, red test, profile, difficulty), all in one wave, same milestone name suffixed `-r2`. Back to step 3. Gate fires again after it merges. No cap on rounds; the human sets the cap.
6. Human replies something else → ask which of the two. Never infer `ACCEPT`.

## What the human owns

- Merging `hive/<run>` into `main`. The lead never does this; it opens the PR or prints the merge command at step 8.
- `CONVENTIONS.md` edits.
- The skills list (`teams/*/skills.txt`) after `hive-scout` proposes.
- Any `NEEDS <dependency>` line a worker raised.

## Cost

Guide brief ≤60 lines ≈ 600 tokens in the lead once. Questions relayed cost the lead twice their length. Keep the guide alive until the verdict; respawning re-reads the diff.
