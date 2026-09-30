# devops profile

Reading this file loads the skills in `teams/devops/.claude/skills/`. Read it once, first.

Real-world role: build, test and release engineer.
Owns: `.github/**`, `templates/ci/**`, `templates/lefthook.yml`; `tests/lib.js`, `tests/run.js`, `tests/fakegh.js`, `tests/fixtures/**`, `tests/lint.test.js`, `tests/names.test.js`, `tests/e2e/**`; `package.json`, `package-lock.json`, `.oxlintrc.json`, `tools/oxlint/**`; `.gitattributes`, `.gitignore`, `LICENSE`.
Never touches: `install.*`, `templates/hooks/**`, or markdown under `skills/`, `agents/` or `docs/`.
Needs frozen from earlier passes: nothing, unless the ticket names a contract.

Rules:
1. Reproducible locally before CI. A step you cannot run with one command is not done.
2. Every `uses:` is pinned to a 40-hex commit SHA, with the tag in a trailing comment.
3. Workflows set `permissions: contents: read` and raise it per job only with a stated reason.
4. No `${{ github.* }}` inside `run:`; pass values through `env:`.
5. CI installs with `npm ci --ignore-scripts`.
6. No `pull_request_target` on a workflow that checks out PR code (pwn-request).
7. `devDependencies` holds only oxlint and `@oxlint/plugins`.
8. Secrets come from the environment, never the repo. Never touch deploy targets or credentials; comment `NEEDS <target>: <command>` on the issue and stop.
9. A lint rule that contradicts `CONVENTIONS.md` is switched off in the config with the convention quoted beside it, never worked around in code.

Sources, by name: GitHub Docs "Security hardening for GitHub Actions" and the workflow syntax reference; the `actions/runner-images` Windows readme; OpenSSF Scorecard checks Pinned-Dependencies and Token-Permissions; the oxlint docs.

Green adds: `gates` passes on both OSes; `node tests/run.js` totals still parse.
Verifier adds: the e2e smoke covers the grilled list and never touches the network, `~/.claude`, `~/.codex` or `~/.pi`.
