# hivemind

A Claude Code skill that runs one ticket through a **lead that only plans**, **parallel workers in git worktrees**, and **a verifier per ticket** (two when the ticket touches auth, input, secrets, or I/O). Agents never talk to each other; they share a task list, interface contracts, and test reports.

Built on top of the [mattpocock-skills](https://github.com/mattpocock/skills) workflow (`/grilling` → `/to-spec` → `/to-tickets` → `/tdd` → `/code-review`) and Claude Code's Agent Teams.

## Why

The usual multi-agent loop bleeds tokens in three places: the lead sits inside the fix loop, verification happens after handoff instead of inside the worker, and agents chat. hivemind fixes all three:

- The lead decides, writes prompts, and dispatches. It writes no code, not even the contract stubs, and never reads diffs. A hook refuses its edits.
- Workers run typecheck, lint, tests, and a dead-code gate themselves, loop to green, and cap at 2 retries.
- Escalation sends only the diff plus failing output to a fresh-context verifier. One pass.
- Independent tickets run in parallel, one git worktree each, merged sequentially.
- Only Sonnet and Opus write or review code: Sonnet for `standard` tickets, Opus for `hard` tickets and every verdict. Fable leads by decision alone. Haiku touches no code; a hook refuses the spawn.
- The pipeline is fixed. A step is skipped or added only when you say so or a `/research` finding does.

Context cost: the description is ~60 tokens per session. The body loads only on `/hivemind` (~1,000 tokens). `references/roles.md` loads at spawn time, `references/stack.md` on first run in a repo, `references/commits.md` when an agent commits. Every other reference loads only at the step that names it, so the lead pays for what the run actually uses.

## Starts itself

`install.sh --project` registers two hooks in the repo's `.claude/settings.local.json` (machine-local, untracked):

- **Autostart.** Every session opened in the repo begins as the lead, skill loaded, no `/hivemind` typed. The hook also prints a `hive-state` line from local files (docs present, skills scouted and linked, gates installed, open `hive/*` branches), so the lead skips what is already set up and spends its first calls on what can never be skipped: tracker preflight, pending human reviews, resuming an open run at the right step, and the baseline on `main`.
- **Lead guard.** On the main thread, edits inside the repo are refused except `CONTEXT.md`, `CONVENTIONS.md`, `AGENTS.md`, and ADRs; an Agent call on Haiku, on the lead's own tier, or with no model on a non-`hive-*` agent is refused.

`HIVEMIND=0 claude` opens a plain session with neither, for the review session or for working by hand.

## Asks before it guesses

Before any spec the lead must be able to state six things without guessing: the user-visible outcome, how you will check it is done, what is out of scope, the modules touched, the constraints, and that no question is open. Any blank and it grills you (`/grill-with-docs`, or `/grilling` on a blank repo), one question at a time. Work bigger than a milestone or a session goes through `/wayfinder` first. Unattended, a work order with a blank is parked, never assumed.

## Survives compaction

Tickets, verdicts, and reviews live in the tracker; the autostart hook re-injects the skill after every auto-compact or `/compact`; and the lead logs every decision that lives nowhere else (grilled answers, an `UNATTENDED` grant, allowed deviations) as one-line comments on a `Run: <run>` issue. After a compaction it rebuilds its position from the tracker and that log, not from the summary.

## Works from any project state

Step 0 of every run reads `references/bootstrap.md` and detects where the repo is:

- **Blank** — grills the idea, runs `/setup-matt-pocock-skills`, writes `CONTEXT.md`, and ships a single scaffold ticket (manifest, typecheck, lint, test runner, smoke test) before any feature wave.
- **Mid-project** — runs every gate on `main`; red gates and dead code become a stabilise ticket that runs alone first. Never dispatches features onto a red baseline.
- **Ready** — confirms gates, `CONTEXT.md`, `AGENTS.md ## Learned` in one line and goes.

## Teams

A team is a folder, not an extra agent. `teams/<profile>/` holds `PROFILE.md` (rules, what green adds, what the verifier checks) and `.claude/skills/` with that profile's skills. Claude Code loads a nested `.claude/skills/` only when an agent first reads a file in that folder, so a worker's first action, "read `teams/frontend/PROFILE.md`", pulls in the frontend skills, and the lead, which never reads under `teams/`, pays nothing for them. Not even the descriptions.

The lead tags each ticket `frontend|backend|devops`, spawns `hive-<profile>-worker`, and takes the verdict from `hive-<profile>-verifier`. Security and QA are verifiers only: security runs as a second verifier on tickets touching auth, input, secrets, or I/O; QA runs once per wave on the integration branch. Verifiers carry `memory: local`, so recurring findings persist on your machine (git-ignored) without touching the lead or the repo.

`teams/<profile>/skills.txt` lists the skills as `<owner/repo> <skill-name>`; `teams/link-skills.sh` links them from `~/.agents/skills` (where `npx skills add` from [skills.sh](https://skills.sh) puts them), `--install` fetches what is missing, `--confine` drops their global links so they exist only inside their team folder. Add a profile with one folder and two thin agent files; see `references/teams.md`.

### Skills are picked for your repo, not mine

The shipped `skills.txt` files are only a starting set. At bootstrap the lead spawns `hive-scout`, which reads your manifests, queries skills.sh for each stack term, ranks by installs, prefers the framework's own org or a large curated set, caps at eight per profile, and rewrites the lists. It prints what it picked and why, then stops. You approve and run the link script. Nothing third-party enters a worker without that yes.

### Required skills

Two skills are the pipeline's, not the scout's; they live in `teams/<profile>/required.txt` and never count against the cap.

- [anti-slop](https://github.com/dmmulroy/anti-slop) — on JS/TS the scaffold or stabilise ticket vendors its oxlint rules into the lint gate. After that slop fails lint in the worker, in lefthook, and in CI, at zero agent tokens.
- [thermo-nuclear-code-quality-review](https://github.com/cursor/plugins/tree/main/cursor-team-kit/skills/thermo-nuclear-code-quality-review) — the QA pass applies it on Opus to every milestone diff; its blockers are tickets and the human gate stays shut until they merge. Per milestone, not per ticket: on a forty-line diff it demands rewrites nobody asked for.

At close the same pass runs the scan phase of mattpocock `improve-codebase-architecture` and files up to five deepening candidates on a `hive-debt` issue for you to pick from. On a blank TypeScript repo the scaffold worker uses [create-better-t-stack](https://github.com/AmanVarshney01/create-better-t-stack) when the grilled stack is one it offers; the stack picks the tool, never the reverse.

## Your conventions, not the model's

Bootstrap refuses to start a ticket without `CONVENTIONS.md` at the repo root. Mid-project, a worker drafts it from evidence (linter config, sample files, commit log) and marks each rule `observed` or `guess`; then the lead asks you, in batches of four, only what is still open: naming, layout, formatting, errors, comments, tests, types, dependencies, commit scopes, forbidden things. One rule per line, examples inline, you own the file. Workers read it right after their profile; verifiers fail a ticket on any deviation. Same code on every file, in your taste. See `references/conventions.md`.

## Human in the loop

Agents verify tickets; you verify milestones. At `/to-tickets` the lead groups tickets into milestones, one user-visible feature each; a single-task run is one milestone. When a milestone merges and QA is green, the lead spawns `hive-guide`, which opens a `Review: <run>/<milestone>` issue with a brief under 60 lines: what changed, exact steps to verify it in under ten minutes, the three to five places an AI most plausibly got wrong, convention deviations, and what evidence it captured (gate output, Playwright screenshots or recordings of each step, CLI transcripts). Then the lead sends a notification and polls the issue for a verdict comment. It does not talk you through the review; it has no diff and every relayed line costs it twice.

You review through whichever channel fits:

- **Review session** — second terminal, `claude`, `/hivemind-review`. A fresh session with the issue, the diff, and the evidence. Ask anything, have it run steps, then say accept or name the problems; it posts the verdict. Zero lead tokens.
- **Phone** — `/remote-control` on that review session, or the GitHub app: read the issue, comment `ACCEPT`.
- **Issue only** — read the brief on GitHub, comment `ACCEPT` or `CHANGES` plus one line per problem. No AI involved.
- **Evidence only** — flip through the linked screenshots, then comment.

`ACCEPT` moves on; `CHANGES` turns each line into a ticket and runs the loop again. Merging `hive/<run>` into `main` is always yours; the lead opens the PR.

### Overnight

Say you are going to sleep, away, or not to wait. The lead prints one warning, what you lose and what stays protected, and continues only on the literal reply `UNATTENDED` (optionally `until 09:00` or `for 3 milestones`). Then at each gate the guide runs its own verify steps, captures evidence, and writes `AUTO-ACCEPT` or, on any mismatch or step it could not execute, `AUTO-HOLD`, which stops the run and pings you. Every auto-accepted milestone keeps its `needs-human` label; when you are back, `/hivemind-review` walks you through them with the evidence and your retroactive `CHANGES` become tickets. Unattended never merges into `main`, approves a dependency, installs a skill, or edits `CONVENTIONS.md`, and it stops on its own at five unreviewed milestones. See `references/review.md`.

## No state in the repo

hivemind writes nothing to your repo but code, tests, contract stubs, and three docs a human wants anyway: `CONTEXT.md`, `CONVENTIONS.md`, `AGENTS.md`. Tickets are issues, milestones are milestones, worker reports and `NEEDS` questions are issue comments, verifier verdicts are PR reviews on a per-ticket PR into `hive/<run>`, review briefs are issues labelled `hive-review`, the human's verdict is a comment, the unattended queue is the `needs-human` label. Screenshots go to an orphan `hive-evidence/<run>` branch that is deleted when the run merges. The Agent Teams task list is only a runtime mirror; if the session dies, nothing is lost.

The tracker is GitHub via `gh` today. `references/tracker.md` is an operations table with one column per tracker; Jira or anything else slots in by filling the column.

## Enforcement, not promises

Rules in prompts drift; these are mechanical.

- **Branch protection + CI.** The scaffold ticket adds `.github/workflows/hive-gates.yml`; every run protects `hive/<run>` so a PR needs the `gates` check green before GitHub lets it merge. The verifier's `MERGE` is a review comment on the PR (one login cannot approve its own PR).
- **Path ownership.** A `PreToolUse` hook in each worker's worktree refuses any edit outside the ticket's owned paths and tells the worker to file `NEEDS` instead.
- **Commit messages.** lefthook runs a commit-msg check: Conventional Commits, 72 chars, no AI trailer. CI re-checks every commit in the PR, so `--no-verify` does not help.
- **Security.** The security verifier runs semgrep on the diff first and queries OSV for every `NEEDS dependency` before the human sees the request.
- **Mutation testing.** Once per milestone, the QA pass mutates the changed files; a surviving mutant is a `WAVE-RED` ticket.
- **Skill pinning.** `teams/skills-lock.json` pins every linked skill's content hash; the link script warns `drift:` when a machine differs.
- **Cost.** Close reports cost per merged ticket from `ccusage`; OpenTelemetry export is one env var away for trends.

Details and the exact commands: `skills/hivemind/references/enforcement.md`.

## Commit rules

Every agent commits with terse, professional [Conventional Commits](https://www.conventionalcommits.org/). **No AI attribution, no `Co-Authored-By`, ever.** See [`skills/hivemind/references/commits.md`](skills/hivemind/references/commits.md). The installer sets `attribution` in `~/.claude/settings.json` so Claude Code stops offering the trailer.

## Install

### Prerequisites (all platforms)

1. [Claude Code](https://code.claude.com/docs/en/overview) installed and logged in.
2. Node.js (Claude Code already needs it) and the [GitHub CLI](https://cli.github.com/) logged in (`gh auth login`); the repo needs a GitHub remote.
3. The mattpocock-skills plugin. Inside Claude Code:
   ```
   /plugin install mattpocock-skills@claude-plugins-official
   ```
   Cherry-picking instead? You need: `setup-matt-pocock-skills`, `grilling`, `grill-with-docs`, `domain-modeling`, `codebase-design`, `wayfinder`, `to-spec`, `to-tickets`, `implement`, `tdd`, `code-review`, `resolving-merge-conflicts`, `handoff`.
4. Recommended companions (each is its own install; the skill works without them but saves less):
   - [caveman](https://github.com/JuliusBrussee/caveman) — terse agent output
   - [ponytail](https://github.com/DietrichGebert/ponytail) — minimal code
   - [rtk](https://github.com/rtk-ai/rtk) — compressed shell output
   - [Chisle](https://github.com/JayPokale/Chisle) is not a companion: it restates caveman and ponytail in one ruleset and the prose styles fight when stacked. Optional, compress hook only (`CHISLE_DEFAULT_MODE=off`); see `references/stack.md`
   - [context-mode](https://github.com/mksglu/context-mode) — sandboxed analysis
   - Claude Code LSP plugin: `/plugin install <language>-lsp@claude-plugins-official`
   - [graphify](https://github.com/safishamsi/graphify) — planning-stage orientation only
   - code-review-graph — verifier blast radius; Serena — alternative to the LSP plugin
   - Gates: `npx fallow` (JS/TS, no install), `vulture-rs` (Python), `cargo machete` (Rust)

### Linux / macOS

```bash
git clone https://github.com/Yousef-Baidas/hivemind.git
cd hivemind
./install.sh                       # skill + agents for every repo
cd /path/to/your/repo
/path/to/hivemind/install.sh --project                     # teams/ with linked skills, lead autostart + guard
/path/to/hivemind/install.sh --project --install --confine # fetch missing, hide from lead
```

After `hive-scout` rewrites a list: `bash teams/link-skills.sh --install --confine` from the repo root.

Then add to your shell rc (`~/.bashrc`, `~/.zshrc`, or `~/.config/fish/config.fish`):

```bash
export CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1        # bash / zsh
set -gx CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS 1         # fish
```

### Windows (PowerShell)

```powershell
git clone https://github.com/Yousef-Baidas/hivemind.git
cd hivemind
.\install.ps1                      # skill + agents for every repo
cd C:\path\to\your\repo
C:\path\to\hivemind\install.ps1 -Project                    # teams\ with linked skills, lead autostart + guard
C:\path\to\hivemind\install.ps1 -Project -Install -Confine  # fetch missing, hide from lead
```

After `hive-scout` rewrites a list: `.\teams\link-skills.ps1 -Install -Confine` from the repo root.

Then set the environment variable for your user:

```powershell
[Environment]::SetEnvironmentVariable("CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS", "1", "User")
```

Restart the terminal afterwards.

### Manual install (any platform)

1. Copy `skills/hivemind/` and `skills/hivemind-review/` to `~/.claude/skills/` (all repos) or `<repo>/.claude/skills/` (one repo).
2. Copy `agents/*.md` to `~/.claude/agents/` (or `<repo>/.claude/agents/`).
3. Copy `teams/` into your repo and run `bash teams/link-skills.sh --install` (or `.\teams\link-skills.ps1 -Install`). Copy `templates/` to `teams/templates/` and run `node teams/templates/hooks/install-lead-hooks.js` from the repo root.
4. Merge into `~/.claude/settings.json`:
   ```json
   { "attribution": { "commit": "", "pr": "", "sessionUrl": false } }
   ```
5. Set `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` in your environment.

### Updating

```bash
cd /path/to/hivemind && git pull && ./install.sh          # skill + agents
cd /path/to/your/repo && /path/to/hivemind/install.sh --project   # hooks, templates, required.txt
```

`--project` never overwrites your `PROFILE.md` or `skills.txt`; it refreshes the link scripts, templates, `required.txt`, and the two lead hooks. Commit the `teams/` changes.

### Check the install

```bash
ls ~/.claude/skills/hivemind/SKILL.md ~/.claude/agents/hive-*.md
grep -c hive- .claude/settings.local.json        # 2, from the repo root
echo '{"source":"startup"}' | CLAUDE_PROJECT_DIR=$PWD node .claude/hooks/hive-autostart.js | sed -n 4p   # the hive-state line
```

## First run

Open `claude` in a repo where you ran `install.sh --project` and hand it the ticket or the idea; the session is already the lead. Anywhere else, type `/hivemind`. Bootstrap handles `/setup-matt-pocock-skills`, `CONTEXT.md`, the conventions interview, the skills scout, and `AGENTS.md ## Learned`, then it walks you through grill → spec → tickets → contracts → dispatch → human review. Start with a small, real ticket with 2–3 independent pieces. Note tokens per merged ticket; that is your baseline for tuning the `standard|hard` routing.

## Layout

```
skills/hivemind/
  SKILL.md                 entry point, loaded on /hivemind
  references/bootstrap.md  blank / mid-project / ready detection and setup
  references/conventions.md  CONVENTIONS.md interview checklist and enforcement
  references/teams.md      profiles, routing, how to add one
  references/review.md     milestones and the human review gate
  references/tracker.md    where state lives: GitHub operations table, Jira slot
  references/roles.md      worker / verifier / guide / scout prompts, lead pre-dispatch check
  references/stack.md      who loads which tool, context budget, worktree lifecycle
  references/enforcement.md  CI, branch protection, ownership hook, lefthook, semgrep, mutation, OSV, cost, skill lock
  references/commits.md    commit message rules
skills/hivemind-review/
  SKILL.md                 the human's review session; writes the verdict the lead waits on
agents/                    thin subagent definitions; each reads its PROFILE.md first
  hive-frontend-worker.md    hive-frontend-verifier.md
  hive-backend-worker.md     hive-backend-verifier.md
  hive-devops-worker.md
  hive-security-verifier.md  second verifier on sensitive tickets
  hive-qa-verifier.md        once per wave on the integration branch
  hive-guide.md              review brief + evidence per milestone; self-verifies when unattended
  hive-scout.md              picks each profile's skills from skills.sh
teams/                     copied into your repo by install.sh --project
  link-skills.sh / .ps1    links (or installs) each profile's skills
  <profile>/PROFILE.md     rules, green additions, verifier checklist
  <profile>/skills.txt     <owner/repo> <skill> lines; links land in .claude/skills/ (git-ignored)
  <profile>/required.txt   pipeline-required skills, same format; the scout never edits it
  skills-lock.json         content hash per linked skill, written by link-skills
  templates/               hive-gates.yml, lefthook.yml, commit-msg.js, hive-owned-paths.js,
                           hive-autostart.js, hive-lead-guard.js, install-lead-hooks.js
install.sh       Linux / macOS installer
install.ps1      Windows installer
```

## Uninstall

Delete `~/.claude/skills/hivemind/`, `~/.claude/skills/hivemind-review/`, `~/.claude/agents/hive-*.md`, `teams/` in any repo, and the two `hive-` entries in its `.claude/settings.local.json`; `.github/workflows/hive-gates.yml`, `lefthook.yml`, and `.claude/hooks/` are yours to keep or drop. Open `hive-*` issues and labels stay on GitHub for you to close. Skills you confined are still in `~/.agents/skills/`; re-link them into `~/.claude/skills/` if you want them global again. Remove the `attribution` key from `~/.claude/settings.json` if you want the default trailer back.

## License

MIT
