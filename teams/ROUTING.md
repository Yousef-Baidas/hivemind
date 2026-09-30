# Routing

One row per deliverable type or path pattern → the one team that owns it. The lead routes every ticket by this table; a ticket with no row is a question for the human, and the answer becomes a row. `security` and `qa` are never routed to; they verify.

| Deliverable or path | Team |
|---|---|
| `install.js`, `install.ps1`, `install.sh`, any new module they require | cli |
| `templates/hooks/**` | cli |
| `templates/teams/*.js`, `*.ps1`, `*.sh`, `templates/teams/.gitignore` | cli |
| `tests/hooks.test.js`, `tests/migrate.test.js`, `tests/safety.test.js`, `tests/selfhost.test.js` | cli |
| `.github/**`, `templates/ci/**`, `templates/lefthook.yml` | devops |
| `tests/lib.js`, `tests/run.js`, `tests/fakegh.js`, `tests/fixtures/**`, `tests/lint.test.js`, `tests/names.test.js`, `tests/e2e/**` | devops |
| `package.json`, `package-lock.json`, `.oxlintrc.json`, `tools/oxlint/**`, `.gitattributes`, `.gitignore`, `LICENSE` | devops |
| `skills/**`, `agents/**` | workflow |
| `docs/**`, `README.md`, `CONTEXT.md`, `CONVENTIONS.md`, `AGENTS.md`, docs-diet tickets | workflow |
| `templates/teams/ROUTING.md`, `templates/teams/*/PROFILE.md`, `templates/teams/*/skills.txt`, `teams/**` except `required.txt` and `skills-lock.json` | workflow |
| `**/required.txt`, `teams/skills-lock.json` | human only |
| a new test for a path | the team that owns the path |

Hotspots, one writer per wave: `install.js`, `tests/hooks.test.js`, `README.md`.
