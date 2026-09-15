# Enforcement

Rules in prompts drift. These make the important ones mechanical. Templates ship in `teams/templates/` (copied by `install.sh --project`); the scaffold or stabilise ticket installs them once.

## 1. CI on every ticket PR + branch protection

Scaffold ticket: copy `teams/templates/ci/hive-gates.yml` to `.github/workflows/`, replace every `EDIT` line with the gate commands from `## Learned`, commit. Then, per run, right after `git push -u origin hive/<run>`:

```
gh api -X PUT "repos/{owner}/{repo}/branches/hive%2F<run>/protection" \
  --input - <<'EOF'
{"required_status_checks":{"strict":true,"contexts":["gates"]},
 "required_pull_request_reviews":null,
 "enforce_admins":false,"restrictions":null}
EOF
```

Now no PR merges into `hive/<run>` without the `gates` check green. Required reviews are not set: worker, verifier, and lead share one `gh` login, and GitHub refuses `--approve` on your own PR, so the verifier's `MERGE` is a review comment and a record, not a lock. Verifier reads `gh pr checks <pr> --json name,state` instead of re-running the suite; it re-runs only what it needs to reproduce a finding, or the whole suite when the checks list is empty.

The PUT fails on a private repo on GitHub Free (403) and `gates` never reports when Actions is disabled. Either → write `protection: none` under `AGENTS.md ## Learned` once, tell the human once, continue with prompt-enforced gates; the verifier then runs the suite itself. Delete the protection with `gh api -X DELETE …/protection` at close before deleting the branch.

## 2. Path ownership hook

Before spawning a worker, in its worktree:

```
mkdir -p <wt>/.claude/hooks
cp teams/templates/hooks/hive-owned-paths.js <wt>/.claude/hooks/
cp teams/templates/hooks/settings.local.json <wt>/.claude/settings.local.json
printf '%s\n' <owned paths and globs> > <wt>/.claude/hive-owned
```

Every `Edit`/`Write` outside the list is refused at the tool level with the `NEEDS` instruction as the error. `Bash` writes (`sed -i`, redirects) are not caught; the verifier's `gh pr diff <pr> --name-only` against the owned paths is the backstop and any file outside them is `BACK-TO-WORKER`. `settings.local.json` and `.claude/hive-owned` are untracked and die with the worktree. No list file → hook allows all, so the lead, verifiers, and bootstrap are unaffected.

## 3. lefthook + commit-msg check

Scaffold ticket: install lefthook (`npm i -D lefthook` / `pip install lefthook` / `cargo binstall lefthook` / `pacman -S lefthook` / `brew install lefthook`), copy `teams/templates/lefthook.yml` to the root and `teams/templates/hooks/commit-msg.js` to `.claude/hooks/`, fill the `EDIT` lines, `lefthook install`. The commit-msg check rejects non-Conventional subjects, >72 chars, and any AI attribution trailer. CI runs the same check on every commit in the PR, so a worker that skipped hooks still fails.

## 4. semgrep in the security verifier

`teams/security/PROFILE.md` runs `semgrep --config p/owasp-top-ten --config p/secrets --json --quiet $(gh pr diff <pr> --name-only)` first and attaches findings, then reads. Missing semgrep → `pipx install semgrep` or note once and continue.

## 5. Cost

Step 8 reports cost per merged ticket from `npx ccusage@latest session --json` (local JSONL, no network), summed over the run's sessions. Long-term trends: Claude Code's OpenTelemetry export (`CLAUDE_CODE_ENABLE_TELEMETRY=1`, `OTEL_METRICS_EXPORTER=otlp`, endpoint of your collector); per-profile cost falls out of the session tags.

## 6. Skill pinning

`teams/link-skills.sh` writes `teams/skills-lock.json` (source and sha256 over the skill's files, per linked skill) and warns `drift: <skill>` when a machine's copy differs from the committed hash. Commit the lock; a teammate whose install drifted re-runs `npx skills update <skill>` or accepts the new hash by re-running the link script with `--relock`.

## 7. Mutation testing per milestone

`teams/qa/PROFILE.md`: once per milestone, on files changed since the milestone's merge-base, run Stryker (`npx stryker run --mutate <files>`), `mutmut run --paths-to-mutate <files>`, or `cargo mutants --file <f>`. Surviving mutants in a changed file → `WAVE-RED` finding `MUTANT <file:line> survives`, ticketed like any other red. Per milestone, not per ticket; it is the slow gate.

## 8. Dependency check on `NEEDS`

Worker comments `NEEDS dependency <ecosystem>/<name>@<version>`. Lead, before asking the human:

```
curl -s https://api.osv.dev/v1/query -d '{"package":{"name":"<name>","ecosystem":"<npm|PyPI|crates.io|Go>"},"version":"<version>"}' \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const v=(JSON.parse(s).vulns||[]);console.log(v.length?v.map(x=>x.id+" "+(x.summary||"")).join("\n"):"osv: clean")})'
```

Result goes into the issue comment with the request. The human still decides; unattended mode parks it.
