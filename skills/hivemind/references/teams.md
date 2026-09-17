# Teams

A team is a **profile**: a folder `teams/<profile>/` holding `PROFILE.md` (rules, green additions, verifier checklist) and `.claude/skills/` (that profile's skills, linked by the installer). Claude Code loads a nested `.claude/skills/` only when an agent first reads a file in that folder. Workers and verifiers read `teams/<profile>/PROFILE.md` as their first action; the lead never reads anything under `teams/`. So profile skills cost the lead nothing, not even their descriptions.

The agent definitions in `agents/` (`hive-<profile>-worker`, `hive-<profile>-verifier`) are thin: model, tools, memory, and "read your PROFILE.md first". No supervisor sits between the lead and a profile. Adding one adds a hop and a context window and removes nothing.

## Profiles

| Profile | Owns | Kind |
|---|---|---|
| `frontend` | UI, styling, client state, a11y | worker + verifier |
| `backend` | API, data, auth, jobs | worker + verifier |
| `devops` | CI, containers, deploy config, env | worker (profile verifier: backend) |
| `security` | cross-cutting | second verifier on tickets touching auth, input, secrets, file or network I/O |
| `qa` | cross-cutting | once per wave on `hive/<run>` |
| `guide` | cross-cutting | human-review brief per milestone; see `review.md` |
| `scout` | cross-cutting | picks each profile's skills at bootstrap |

Skills per profile live in `teams/<profile>/skills.txt`, one `<owner/repo> <skill-name>` per line, resolved from [skills.sh](https://skills.sh). The shipped lists are defaults; `hive-scout` rewrites them for the repo's stack at bootstrap, ranked by installs, and the human approves before `teams/link-skills.sh --install` pulls them in. Keep each list to what the role uses on most tickets, eight at most. Everything else stays global and on-demand.

`teams/<profile>/required.txt`, same format, is the pipeline's: `install-anti-slop` for devops (the scaffold ticket turns it into a lint gate), `thermo-nuclear-code-quality-review` for qa (every milestone). The scout never rewrites it, it does not count against the eight, and `install.sh --project` refreshes it. A missing required skill stops the run.

Models: workers are Sonnet (`standard`) or Opus (`hard`); profile and security verifiers are Opus; QA is Sonnet per wave, Opus per milestone and at close; guide and scout are Sonnet and touch no code. Haiku and the lead's own model never write or review code.

## Routing

- Tag at `/to-tickets`: `profile: frontend|backend|devops`. A ticket needing two profiles is two tickets with a contract between them.
- `security` is never tagged. The lead attaches `hive-security-verifier` as a second verifier when the ticket touches auth, input parsing, secrets, file or network I/O. Both verdicts must be `MERGE`.
- `qa` runs once per wave, not per ticket. Per-ticket gates already are the QA.

## Confinement

`~/.claude/skills/` loads in every session, lead included. To keep a domain skill out of the lead entirely, it must live only under `teams/<profile>/.claude/skills/`. `teams/link-skills.sh --confine` removes the global symlink for every skill it linked into a profile (symlinks only; real directories are left alone). The lead keeps: hivemind, the mattpocock skills, caveman, ponytail, rtk, context-mode, graphify.

Bootstrap is the one exception: the scaffold ticket's worker may read several profiles' `PROFILE.md` to set up gates for each.

## What this does not buy

Verifiers catch contract violations, dead code, and known anti-patterns. Correctness comes from the red test the lead wrote at step 3. A ticket without a real failing test has no verifier that can save it. "Nothing left unreviewed" is a property of file ownership plus a red test per ticket, not of how many reviewers exist.

## Adding a profile

1. `mkdir teams/<name>`; write `PROFILE.md` (owns, rules, green adds, verifier adds) and `skills.txt`.
2. Copy `agents/hive-backend-worker.md` and `-verifier.md`, rename, point the first action at the new `PROFILE.md`.
3. Add a row above. Run `bash teams/link-skills.sh --install`.
