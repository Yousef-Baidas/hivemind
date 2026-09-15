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
./install.sh
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
.\install.ps1
```

Then set the environment variable for your user:

```powershell
[Environment]::SetEnvironmentVariable("CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS", "1", "User")
```

Restart the terminal afterwards.

### Manual install (any platform)

1. Copy `skills/hivemind/` to `~/.claude/skills/hivemind/` (all repos) or `<repo>/.claude/skills/hivemind/` (one repo).
2. Merge into `~/.claude/settings.json`:
   ```json
   { "attribution": { "commit": "", "pr": "", "sessionUrl": false } }
   ```
3. Set `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` in your environment.

## Per-repo setup

1. Run `/setup-matt-pocock-skills` once. hivemind refuses to start without it.
2. Add an empty `## Learned` heading to `AGENTS.md` (or `CLAUDE.md`). That heading is the team's only shared memory.

## First run

Pick a small, real ticket with 2–3 independent pieces. Type `/hivemind` and hand it the ticket. It walks you through grill → spec → tickets → contracts → dispatch. Note tokens per merged ticket; that is your baseline for tuning the `routine|standard|hard` routing.

## Layout

```
skills/hivemind/
  SKILL.md                 entry point, loaded on /hivemind
  references/roles.md      worker / verifier prompts, lead pre-dispatch check
  references/stack.md      who loads which tool, context budget, worktree lifecycle
  references/commits.md    commit message rules
install.sh       Linux / macOS installer
install.ps1      Windows installer
```

## Uninstall

Delete `~/.claude/skills/hivemind/`. Remove the `attribution` key from `~/.claude/settings.json` if you want the default trailer back.

## License

MIT
