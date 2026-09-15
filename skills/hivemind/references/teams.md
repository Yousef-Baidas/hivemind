# Teams

A team is a **profile**, not an extra agent. It is a subagent definition in `agents/` that fixes three things: which skills preload, which gates count as green, and what its verifier checks. The lead tags each ticket with a profile and spawns `hive-<profile>-worker`; the verdict comes from `hive-<profile>-verifier`. No supervisor sits between the lead and the team. Adding one adds a hop and a context window and removes nothing.

The lead never reads a profile's skills. Only the worker and verifier carry them.

## Profiles

| Profile | Owns | Worker preloads | Verifier adds |
|---|---|---|---|
| `frontend` | UI, styling, client state, a11y | `web-design-guidelines`, `vercel-react-best-practices` | `impeccable` audit, a11y, no inline design drift |
| `backend` | API, data, auth, jobs | `modern-javascript-patterns` or language equivalent, `sql-optimization` | `sql-code-review`, contract honoured, migrations reversible |
| `devops` | CI, containers, deploy, env | `multi-stage-dockerfile` | secrets not in repo, CI green locally reproducible |
| `security` | cross-cutting; a verifier only | – | `security-review` on any ticket touching auth, input, secrets, file or network I/O |
| `qa` | cross-cutting; a verifier only | – | integration suite + e2e on `hive/<run>` at close; `playwright-best-practices` |

Preload only the two or three skills the worker will use on every ticket. Everything else stays discoverable and is invoked on demand by the worker, never by the lead.

## Routing

- Tag at `/to-tickets`: `profile: frontend|backend|devops`. A ticket that needs two profiles is two tickets with a contract between them.
- `security` is not a profile you tag. The lead attaches `hive-security-verifier` as a **second** verifier when the ticket touches auth, input parsing, secrets, file or network I/O. Both verdicts must be `MERGE`.
- `qa` runs once per wave on the integration branch, not per ticket. The per-ticket gates already are the QA.

## What this does not buy

Verifiers catch contract violations, dead code, and known anti-patterns. Correctness comes from the red test the lead wrote at step 3. A ticket without a real failing test has no verifier that can save it. "Nothing left unreviewed" is a property of file ownership plus a red test per ticket, not of how many reviewers exist.

## Adding a profile

1. Copy `agents/hive-backend-worker.md` and `agents/hive-backend-verifier.md`, rename.
2. Set `skills:` to at most three that the role uses every time. Find more on skills.sh; install with `npx skills add <owner/repo>`.
3. Set `memory: project` on the verifier so recurring findings persist in `.claude/agent-memory/` without touching the lead.
4. Add a row above. Re-run `install.sh`.
