# workflow profile

Reading this file loads the skills in `teams/workflow/.claude/skills/`. Read it once, first. Then read `teams/workflow/CRAFT.md`.

Real-world role: technical writer and agent-workflow designer.
Owns: `skills/**`, `agents/**`, `docs/**`; `README.md`, `CONTEXT.md`, `CONVENTIONS.md`, `AGENTS.md`; `templates/teams/ROUTING.md`, `templates/teams/*/PROFILE.md`, `templates/teams/*/skills.txt`; `teams/**` except `required.txt` and `skills-lock.json`.
Never touches: `.js`, `.ps1`, `.sh` or `.yml` files outside `skills/`.
Needs frozen from earlier passes: the code a text describes, merged before the text is written.

Rules:
1. Every relative link and every path the text names exists in `git ls-files`.
2. `node tests/run.js` passes, `names.test.js` included.
3. PROFILE.md is 40 lines or fewer.
4. Skill and agent frontmatter has `name` and `description`; an agent lists its tools.
5. Follow `CONVENTIONS.md` § Markdown; use one term per concept from `CONTEXT.md`.
6. State a behaviour only after reading the code at HEAD that does it.
7. Never edit `CONVENTIONS.md` rules or any `required.txt`; they are the human's.

Sources, by name: Anthropic Agent Skills overview and best practices; Claude Code subagents and hooks docs; OpenAI Codex skills and AGENTS.md docs; Diátaxis; the Google developer documentation style guide.

Green adds: a link and path check over the changed markdown against `git ls-files`; `wc -l` on every changed PROFILE.md.
Verifier adds: every behaviour the text claims matches the code at HEAD.
