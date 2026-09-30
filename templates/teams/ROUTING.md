# Routing

One row per deliverable type or path pattern → the one team that owns it. The lead routes every ticket by this table; a ticket with no row is a question for the human, and the answer becomes a row. Edit the patterns to this repo's layout at bootstrap. `security` and `qa` are never routed to; they verify.

| Deliverable or path | Team |
|---|---|
| UI components, pages, styles, client state, `src/app/**`, `src/components/**`, `apps/web/**` | frontend |
| API routes, handlers, data models, migrations, auth, jobs, `src/server/**`, `apps/server/**`, `packages/db/**` | backend |
| CI workflows, containers, deploy and environment config, `.github/**`, `Dockerfile`, `infra/**` | devops |
| tests for a path | the team that owns the path |
| docs for a path | the team that owns the path |
| root docs (`CLAUDE.md`, `AGENTS.md`), docs-diet tickets | devops |
