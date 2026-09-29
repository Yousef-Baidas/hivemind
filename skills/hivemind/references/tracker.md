# Tracker

hivemind keeps no state in the repo. Tickets, milestones, the run log, maps, worker reports, verdicts, debt, review briefs, and the review queue live in the tracker. The repo gets deliverables, checks, contracts, lessons, ADRs, and the three docs a human would want anyway: `CONTEXT.md`, `CONVENTIONS.md`, `AGENTS.md`. Nothing else. `teams/` is config, shared like lint config. Agent memory is `local` (git-ignored); hook state is under `.git/hive/`, never committed.

The Agent Teams task list is a runtime mirror; if it and the tracker disagree, the tracker wins. A session that dies loses nothing.

Tracker today: **GitHub** via `gh`. Jira and others slot in by filling the second column; the operations do not change.

## Operations

| Operation | GitHub |
|---|---|
| preflight | `gh auth status` and `gh repo view --json nameWithOwner -q .nameWithOwner`; either fails → stop, tell the human |
| labels (once) | `gh label create hive`, `hive-log`, `hive-review`, `hive-debt`, `hive-question`, `needs-human`, `needs-research`, `difficulty:standard|hard`, and `profile:<team>` for every team in `teams/ROUTING.md` (`--force`, ignore exists); a team added later gets its label then |
| run log | one per run: `gh issue create --title "Run: <run>" --label hive-log --body "lead's decision log"`; one comment per decision that lives nowhere else (grilled decisions pre-spec, `UNATTENDED` grant, allowed deviations, parked `NEEDS`, fork point, human hand edits, pause positions, revision mode start and end). The autostart prints its tail at startup and after a compaction. Closed at step 8 |
| debt | one per milestone, opened with the milestone: `gh issue create --title "Debt: <run>/<m>" --label hive-debt --milestone "<run>/<m>" --body "verifier follow-ups; each line fixed, re-scoped, or dropped by the human at close"`. Verifiers add one comment per non-blocking finding: `#<ticket> <file:line or part> <what> — <why it can wait>`. Never a ticket per follow-up |
| map | `/wayfinder` writes its map as an issue labelled `wayfinder:map`; the repo gets no map file |
| milestone | `gh api repos/{owner}/{repo}/milestones -f title="<run>/<milestone>"` |
| ticket | `gh issue create --title "<id>: <intent line>" --label hive,profile:<team>,difficulty:<d> --milestone "<run>/<m>" --body-file -` (body: intent, interface, the check as name + input + expected result, owned paths, depends-on; `needs-research` label when it rests on outside facts) |
| protect branch (per run) | after `git push -u origin hive/<run>`: `gh api -X PUT "repos/{owner}/{repo}/branches/hive%2F<run>/protection" --input -` with the JSON in `enforcement.md` §1; requires check `gates` green. 403 → `protection: none` in `## Learned`, continue |
| ticket url → worker | the issue number is the ticket id; the worker gets the number, not the body pasted |
| worker report | `gh issue comment <n> --body "DONE …"` / `NEEDS …` / `RED …` + diff and failing output |
| CI status | `gh pr checks <pr> --json name,state`; verifier reads it, re-runs only to reproduce a finding |
| verifier verdict | worker branch has a PR into `hive/<run>`: `gh pr review <pr> --comment --body "MERGE"` or `--request-changes --body "BACK-TO-WORKER …"` (`--approve` is refused on your own PR); `CONTRACT-WRONG` → comment on the issue, close PR |
| merge | `git worktree remove <wt>` first, then `gh pr merge <pr> --merge --delete-branch` into `hive/<run>`, full suite on `hive/<run>`; `gh issue close <n>` |
| review brief | `gh issue create --title "Review: <run>/<milestone>" --label hive-review,needs-human --milestone … --body-file <brief>` |
| evidence | text transcripts inline in the brief. Screenshots and recordings go on branch `hive-evidence/<run>`: first milestone `git checkout --orphan`, later ones `git fetch origin hive-evidence/<run> && git checkout FETCH_HEAD`; add files, commit, `git push origin HEAD:refs/heads/hive-evidence/<run>`; link raw URLs; branch deleted at close |
| verdict | human comment on the review issue whose first line is `ACCEPT` or `CHANGES`; unattended guide comments `AUTO-ACCEPT` / `AUTO-HOLD` |
| question | `gh issue create --title "Q: <run>: <one line>" --label hive-question,needs-human --body-file -` (body: the question, numbered options, `Recommended: <n> because …`, parked tickets `#…`, what happens on each option). Answer: a comment whose first line is `ANSWER <option or text>`; the lead acts, logs it on the run log, closes the issue. Never edited, never asked twice |
| revision | `gh issue create --title "Revision <run>/<m> r<k>" --label hive --milestone …`; one comment per tweak, evidence, and human `ok` (`operations.md`) |
| wait for verdict | poll every 30 s with the command under the table |
| accept | remove `needs-human`, close the review issue, close the milestone |
| queue (unattended) | review issues still labelled `needs-human`; `/hivemind-review` lists `gh issue list --label needs-human --state open` |
| learned | still `AGENTS.md ## Learned`; that file is for the next human too |
| close run | PR `hive/<run>` → `main`, body links the milestones; `gh api -X DELETE "repos/{owner}/{repo}/branches/hive%2F<run>/protection"` then `git push origin --delete hive-evidence/<run>` after merge |

Verdict poll, background shell, exits on the first verdict comment:

```
until v=$(gh issue view <n> --json comments -q '[.comments[].body | select(test("^(ACCEPT|CHANGES|AUTO-ACCEPT|AUTO-HOLD)"))] | last' 2>/dev/null) && [ -n "$v" ] && [ "$v" != null ]; do sleep 30; done; echo "$v"
```

Read tracker output with `--json … -q` always. A raw `gh issue view` costs the lead more than the ticket did.

Every agent posts as the same GitHub account, so a comment is never edited or overwritten: no `gh … --edit-last`, no `gh api -X PATCH` on a comment. A correction is a new comment. The guards refuse `--edit-last`.

## Adding a tracker

Copy this file to `tracker-<name>.md`, fill the second column, and set `tracker: <name>` in `AGENTS.md ## Learned`. The lead reads the matching file at step 0.
