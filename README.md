# hivemind

A Claude Code skill that runs one ticket through a **lead that only plans**, **parallel workers in git worktrees**, and **one verifier**. Agents never talk to each other; they share a task list, interface contracts, and test reports.

Built on top of the [mattpocock-skills](https://github.com/mattpocock/skills) workflow (`/grilling` → `/to-spec` → `/to-tickets` → `/tdd` → `/code-review`) and Claude Code's Agent Teams.

## Why

The usual multi-agent loop bleeds tokens in three places: the lead sits inside the fix loop, verification happens after handoff instead of inside the worker, and agents chat. hivemind fixes all three:

- The lead decomposes, writes contracts, and arbitrates. It never patches and never reads diffs.
- Workers run typecheck, lint, tests, and a dead-code gate themselves, loop to green, and cap at 2 retries.
- Escalation sends only the diff plus failing output to a fresh-context verifier. One pass.
- Independent tickets run in parallel, one git worktree each, merged sequentially.
- Models are routed by difficulty: Haiku for mechanical work, Sonnet for well-specified units, Opus for ambiguous units and review, Fable as lead.

Context cost: the description is ~60 tokens per session. The body loads only on `/hivemind` (~760 tokens). `references/roles.md` loads at spawn time, `references/stack.md` on first run in a repo, `references/commits.md` when an agent commits. A full run costs the lead under ~1,500 tokens of skill text.

## Works from any project state

Step 0 of every run reads `references/bootstrap.md` and detects where the repo is:

- **Blank** — grills the idea, runs `/setup-matt-pocock-skills`, writes `CONTEXT.md`, and ships a single scaffold ticket (manifest, typecheck, lint, test runner, smoke test) before any feature wave.
- **Mid-project** — runs every gate on `main`; red gates and dead code become a stabilise ticket that runs alone first. Never dispatches features onto a red baseline.
- **Ready** — confirms gates, `CONTEXT.md`, `AGENTS.md ## Learned` in one line and goes.

## Teams

A team is a folder, not an extra agent. `teams/<profile>/` holds `PROFILE.md` (rules, what green adds, what the verifier checks) and `.claude/skills/` with that profile's skills. Claude Code loads a nested `.claude/skills/` only when an agent first reads a file in that folder, so a worker's first action, "read `teams/frontend/PROFILE.md`", pulls in the frontend skills, and the lead, which never reads under `teams/`, pays nothing for them. Not even the descriptions.

The lead tags each ticket `frontend|backend|devops`, spawns `hive-<profile>-worker`, and takes the verdict from `hive-<profile>-verifier`. Security and QA are verifiers only: security runs as a second verifier on tickets touching auth, input, secrets, or I/O; QA runs once per wave on the integration branch. Verifiers carry `memory: project`, so recurring findings persist in `.claude/agent-memory/` without touching the lead.

`teams/<profile>/skills.txt` lists the skills; `install.sh --project` links them from `~/.agents/skills` (where `npx skills add` from [skills.sh](https://skills.sh) puts them) and reports what is missing. Add `--confine` to also drop those skills' global links, so they exist only inside their team folder. Add a profile with one folder and two thin agent files; see `references/teams.md`.

## Commit rules

Every agent commits with terse, professional [Conventional Commits](https://www.conventionalcommits.org/). **No AI attribution, no `Co-Authored-By`, ever.** See [`skills/hivemind/references/commits.md`](skills/hivemind/references/commits.md). The installer sets `attribution` in `~/.claude/settings.json` so Claude Code stops offering the trailer.

## Install

### Prerequisites (all platforms)

1. [Claude Code](https://code.claude.com/docs/en/overview) installed and logged in.
2. Node.js (Claude Code already needs it).
3. The mattpocock-skills plugin. Inside Claude Code:
   ```
   /plugin install mattpocock-skills@claude-plugins-official
   ```
   Cherry-picking instead? You need: `setup-matt-pocock-skills`, `grilling`, `grill-with-docs`, `to-spec`, `to-tickets`, `implement`, `tdd`, `code-review`, `resolving-merge-conflicts`, `handoff`.
4. Recommended companions (each is its own install; the skill works without them but saves less):
   - [caveman](https://github.com/JuliusBrussee/caveman) — terse agent output
   - [ponytail](https://github.com/DietrichGebert/ponytail) — minimal code
   - [rtk](https://github.com/rtk-ai/rtk) — compressed shell output
   - [context-mode](https://github.com/mksglu/context-mode) — sandboxed analysis
   - Claude Code LSP plugin: `/plugin install <language>-lsp@claude-plugins-official`
   - [graphify](https://github.com/safishamsi/graphify) — planning-stage orientation only
   - Gates: `npx fallow` (JS/TS, no install), `vulture-rs` (Python), `cargo machete` (Rust)

### Linux / macOS

```bash
git clone https://github.com/Yousef-Baidas/hivemind.git
cd hivemind
./install.sh                       # skill + agents for every repo
cd /path/to/your/repo
/path/to/hivemind/install.sh --project           # teams/ with linked skills
/path/to/hivemind/install.sh --project --confine # ...and hide them from the lead
```

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
C:\path\to\hivemind\install.ps1 -Project           # teams\ with linked skills
C:\path\to\hivemind\install.ps1 -Project -Confine  # ...and hide them from the lead
```

Then set the environment variable for your user:

```powershell
[Environment]::SetEnvironmentVariable("CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS", "1", "User")
```

Restart the terminal afterwards.

### Manual install (any platform)

1. Copy `skills/hivemind/` to `~/.claude/skills/hivemind/` (all repos) or `<repo>/.claude/skills/hivemind/` (one repo).
2. Copy `agents/*.md` to `~/.claude/agents/` (or `<repo>/.claude/agents/`).
3. Copy `teams/` into your repo; for each `teams/<profile>/skills.txt` entry, symlink (or junction) the skill folder into `teams/<profile>/.claude/skills/<name>`.
4. Merge into `~/.claude/settings.json`:
   ```json
   { "attribution": { "commit": "", "pr": "", "sessionUrl": false } }
   ```
5. Set `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` in your environment.

## First run

Type `/hivemind` in any repo, blank or not, and hand it the ticket or the idea. Bootstrap handles `/setup-matt-pocock-skills`, `CONTEXT.md`, and `AGENTS.md ## Learned`, then it walks you through grill → spec → tickets → contracts → dispatch. Start with a small, real ticket with 2–3 independent pieces. Note tokens per merged ticket; that is your baseline for tuning the `routine|standard|hard` routing.

## Layout

```
skills/hivemind/
  SKILL.md                 entry point, loaded on /hivemind
  references/bootstrap.md  blank / mid-project / ready detection and setup
  references/teams.md      profiles, routing, how to add one
  references/roles.md      worker / verifier prompts, lead pre-dispatch check
  references/stack.md      who loads which tool, context budget, worktree lifecycle
  references/commits.md    commit message rules
agents/                    thin subagent definitions; each reads its PROFILE.md first
  hive-frontend-worker.md    hive-frontend-verifier.md
  hive-backend-worker.md     hive-backend-verifier.md
  hive-devops-worker.md
  hive-security-verifier.md  second verifier on sensitive tickets
  hive-qa-verifier.md        once per wave on the integration branch
teams/<profile>/           copied into your repo by install.sh --project
  PROFILE.md               rules, green additions, verifier checklist
  skills.txt               skills to link into .claude/skills/ (git-ignored)
install.sh       Linux / macOS installer
install.ps1      Windows installer
```

## Uninstall

Delete `~/.claude/skills/hivemind/`, `~/.claude/agents/hive-*.md`, and `teams/` in any repo. Skills you confined are still in `~/.agents/skills/`; re-link them into `~/.claude/skills/` if you want them global again. Remove the `attribution` key from `~/.claude/settings.json` if you want the default trailer back.

## License

MIT
