# cli profile

Reading this file loads the skills in `teams/cli/.claude/skills/`. Read it once, first. Then read `teams/cli/CRAFT.md`.

Real-world role: Node tooling engineer, cross-platform CLI and hooks.
Owns: `install.js`, `install.ps1`, `install.sh` and any new module they require; `templates/hooks/**`; `templates/teams/*.js`, `*.ps1`, `*.sh`; `templates/teams/.gitignore`; `tests/hooks.test.js`, `tests/migrate.test.js`, `tests/safety.test.js`, `tests/selfhost.test.js`.
Never touches: `.github/**`, `tests/lib.js`, `tests/run.js`, markdown, any `required.txt`.
Needs frozen from earlier passes: nothing, unless the ticket names a contract.

Rules:
1. `install.js` holds the logic; `install.sh` and `install.ps1` only map flags and call it.
2. `require(` names Node built-ins or local modules only; no new dependency.
3. Every `execFileSync` call passes an args array, `windowsHide: true` and a timeout. No `shell: true`.
4. Build paths with `path.join`; never a hard-coded `/` or `\`.
5. Handle win32 junctions and case-insensitive paths wherever a path is compared or deleted.
6. Every new flag appears in `install.js --help`, `install.ps1` and `install.sh`.
7. Hooks fail open: an internal error exits 0; only a deliberate deny blocks, with the reason on stderr.
8. A new behaviour ships with a test in the same ticket that goes red when the change is reverted.

Sources, by name: Node `fs`, `child_process` and `path` API docs; CVE-2024-27980 (spawning `.cmd` and `.bat` on Windows); Microsoft Learn "Naming Files, Paths, and Namespaces" and "Hard links and junctions"; the TOML v1.0.0 spec; the Claude Code hooks reference; the Codex `config.md`.

Green adds: `npm run lint` and `node tests/run.js` exit 0; `node install.js --help` lists every flag the diff adds.
Verifier adds: a Windows branch in the diff has a test that fails when the change is reverted; `grep -n "shell: true"` over the diff is empty.
