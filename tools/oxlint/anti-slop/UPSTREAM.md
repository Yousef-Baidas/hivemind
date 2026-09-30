# Vendored anti-slop Oxlint plugin

Origin: the plugin was copied into this repo by commit `7ea4553` ("build: add oxlint lint gate with vendored anti-slop plugin", 2026-09-29), which is the only commit touching this directory. The copy is byte-identical to `assets/anti-slop/` of the local `install-anti-slop` Claude Code skill (`~/.claude/skills/install-anti-slop`), checked with `diff -rq` on 2026-09-30.

Unknown, not recorded anywhere in this repo or in that skill:

- the source repository of the plugin's own code (`index.ts`, `rules/`, `shared/`, `effect/`);
- the source commit;
- the licence of that code. No LICENSE file sits beside it, and the files carry no licence header.

Do not treat the plugin's own code as MIT on the strength of this repo's root LICENSE. Until the author states a licence, redistribution rights are unconfirmed.

Known provenance: `vendor/eslint-stylistic/` is a copy of the ESLint Stylistic `padding-line-between-statements` rule, MIT, with its LICENSE and its own record in `vendor/eslint-stylistic/UPSTREAM.md` (source commit `435c3ea0fd26a5fef9042c4b36b6e165fbbf8d08`).

Local use: loaded by `.oxlintrc.json` as a JS plugin; `npm run lint` runs it.

Open item: find the source repository and licence of the skill's assets (the skill's author), then replace the "unknown" list above with the repo, commit and licence.
