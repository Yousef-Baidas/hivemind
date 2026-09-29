# AGENTS.md

Proteus source repo. Read `CONTEXT.md` for terms and `CONVENTIONS.md` for rules before touching code.

## Learned

- domain: code (Node CLI installer + hooks + markdown skills); zero dependencies.
- tracker: github (`Yousef-Baidas/proteus`); labels: created (profile labels added with the roster).
- gate: `node tests/hooks.test.js` (exit code); no CI yet — the stabilise ticket adds `.github/workflows/` and the commit-msg hook.
- package manager: none (no package.json).
- test layout: `tests/*.test.js`, plain Node, fake CLIs in `tests/`.
- hotspot files: `install.js`, `install.ps1`, `install.sh`, `templates/hooks/proteus-harness.js`, `templates/hooks/proteus-lib.js`, `tests/hooks.test.js`, `README.md`.
- self-host: `install.js --project` refuses to run in this checkout (install.js:674) until the self-host ticket lands.
- Work to CONVENTIONS.md. Verifier fails the ticket on a deviation.
