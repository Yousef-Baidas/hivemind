# Tool stack

Read once per repo. Record the applicable rows under `## Learned` in `AGENTS.md`.

## Always on

| Tool | Where | Why |
| --- | --- | --- |
| rtk | every agent | compresses shell output before it enters context |
| context-mode | every agent | runs analysis in a sandbox, only the answer enters context |
| caveman | every agent | shrinks what the agent says |
| ponytail | workers | shrinks what the agent builds |
| LSP plugin (or Serena) | workers, verifier | exact symbol navigation; replaces grepping |
| graphify | lead, planning only | orientation on an unfamiliar repo; never per worker |

## Gates by language

"Green" for a worker means every row for its language passes on its owned paths.

### JavaScript / TypeScript

- typecheck: `tsc --noEmit` (or the repo's script)
- lint: repo's eslint/biome script
- tests: single file while iterating, full suite once at the end
- dead code: `npx fallow dead-code <owned paths>`
- verifier adds: `npx fallow dupes` on the diff
- lead at close: `npx fallow health`

### Python

- typecheck: `pyright` or `mypy` per repo
- lint: `ruff check`
- tests: `pytest <file>` while iterating, full suite once
- dead code: `vulture --min-confidence 80 <owned paths>` (use `vulture-rs`, same CLI, much faster)
- verifier adds: `vulture` on changed files

### Rust

- typecheck + lint: `cargo clippy -- -D warnings`
- tests: `cargo test <module>` while iterating, `cargo test` once
- dead code: `cargo machete` (unused deps); clippy already flags unused items

## Optional

- code-review-graph (MCP) — verifier only, for blast-radius on a diff
- Composio Agent Orchestrator / Conductor — only once one terminal cannot hold the number of workers
