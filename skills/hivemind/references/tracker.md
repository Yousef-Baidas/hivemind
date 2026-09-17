# Tracker

hivemind keeps no state in the repo. Tickets, milestones, worker reports, verdicts, review briefs, and the review queue live in the tracker. The repo gets code, tests, contracts, and the three docs a human would want anyway: `CONTEXT.md`, `CONVENTIONS.md`, `AGENTS.md`. Nothing else. `teams/` is config, shared like lint config. Agent memory is `local` (git-ignored).

The Agent Teams task list is a runtime mirror; if it and the tracker disagree, the tracker wins. A session that dies loses nothing.

Tracker today: **GitHub** via `gh`. Jira and others slot in by filling the second column; the operations do not change.

## Operations

| Operation | GitHub |
|---|---|
| preflight | `gh auth status` and `gh repo view --json nameWithOwner -q .nameWithOwner`; either fails → stop, tell the human |
| labels (once) | `gh label create hive`, `hive-review`, `needs-human`, `profile:frontend|backend|devops`, `difficulty:standard|hard`, `hive-debt` (`--force`, ignore exists) |
| run log | one per run: `gh issue create --title "Run: <run>" --label hive --body "lead's decision log"`; one comment per decision that lives nowhere else (grilled decisions pre-spec, `UNATTENDED` grant, allowed deviations, parked `NEEDS`, fork point). Read back after a compaction or a new session: `gh issue view <n> --json comments -q '.comments[].body'`. Closed at step 8 |
| milestone | `gh api repos/{owner}/{repo}/milestones -f title="<run>/<milestone>"` |
| ticket | `gh issue create --title "<id>: <intent line>" --label hive,profile:<p>,difficulty:<d> --milestone "<run>/<m>" --body-file -` (body: intent, contract signatures as a code block, red test as name + input + expected assertion, owned paths, depends-on) |
| protect branch (per run) | after `git push -u origin hive/<run>`: `gh api -X PUT "repos/{owner}/{repo}/branches/hive%2F<run>/protection" --input -` with the JSON in `enforcement.md` §1; requires check `gates` green. 403 → `protection: none` in `## Learned`, continue |
| ticket url → worker | the issue number is the ticket id; the worker gets the number, not the body pasted |
| worker report | `gh issue comment <n> --body "DONE …"` / `NEEDS …` / `RED …` + diff and failing output |
| CI status | `gh pr checks <pr> --json name,state`; verifier reads it, re-runs only to reproduce a finding |
| verifier verdict | worker branch has a PR into `hive/<run>`: `gh pr review <pr> --comment --body "MERGE"` or `--request-changes --body "BACK-TO-WORKER …"` (`--approve` is refused on your own PR); `CONTRACT-WRONG` → comment on the issue, close PR |
| merge | `git worktree remove <wt>` first, then `gh pr merge <pr> --merge --delete-branch` into `hive/<run>`, full suite on `hive/<run>`; `gh issue close <n>` |
| review brief | `gh issue create --title "Review: <run>/<milestone>" --label hive-review,needs-human --milestone … --body-file <brief>` |
| evidence | text transcripts inline in the brief. Screenshots and recordings go on branch `hive-evidence/<run>`: first milestone `git checkout --orphan`, later ones `git fetch origin hive-evidence/<run> && git checkout FETCH_HEAD`; add files, commit, `git push origin HEAD:refs/heads/hive-evidence/<run>`; link raw URLs; branch deleted at close |
| verdict | human comment on the review issue whose first line is `ACCEPT` or `CHANGES`; unattended guide comments `AUTO-ACCEPT` / `AUTO-HOLD` |
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

## Adding a tracker

Copy this file to `tracker-<name>.md`, fill the second column, and set `tracker: <name>` in `AGENTS.md ## Learned`. The lead reads the matching file at step 0.
