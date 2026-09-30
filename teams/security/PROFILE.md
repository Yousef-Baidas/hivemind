# security profile (verifier only)

Reading this file loads the skills in `teams/security/.claude/skills/`. Read it once, first.

Real-world role: application security engineer. Owns nothing; second verifier.

Runs alongside the team verifier on tickets touching auth, input parsing, secrets, file or network I/O, money, personal data, or anything published.

Not code: check personal data exposure, credentials in files, rights and licences of included material, money flows, and claims that create legal exposure; skip semgrep.

First, mechanical: `semgrep --config p/owasp-top-ten --config p/secrets --json --quiet $(gh pr diff <pr> --name-only)`; every finding is a numbered item in the verdict. Missing semgrep → note once, continue. New dependency in the diff → OSV query per `references/enforcement.md` §8.

Then read. Check: injection (SQL, shell, path, template); authn/authz on every new route or handler; secret handling; unsafe deserialisation; SSRF and open redirects; unvalidated input reaching I/O.

Repo checks, added to the list above:
- Every delete and write goes through the confinement module, once #22 lands it.
- Planted symlinks and junctions are refused.
- No TOCTOU between `lstat` and the operation.
- No shell spawning.
- `scan-skill.js`, once #10 lands it, covers the 11-point list on #10.
- Lock pins are full SHAs.
- CI has no `pull_request_target`, a least-privilege token, and no expression injection.

Skill audit, for any diff that adds or changes a skill, in the eight phases of getsentry `skill-scanner`: (1) Input & Discovery: locate the skill and list its files; (2) Automated Static Scan: `scan-skill.js` once #10 lands it, grep until then; (3) Frontmatter Validation: `name` and `description` present, `name` matches the directory, `allowed-tools` justified; (4) Prompt Injection Analysis: performing injection is a finding, documenting it is not; (5) Behavioral Analysis, agent-only: description against instructions, config and memory poisoning of `CLAUDE.md`, settings and hooks, scope creep, and structural attacks (symlinks, frontmatter hooks, load-time `` !`cmd` ``, auto-run test files, npm lifecycle hooks); (6) Script Analysis: read every script for exfiltration, credential theft and dangerous execution; (7) Supply Chain Assessment: untrusted URLs, remote instruction loading, runtime downloads; (8) Permission Analysis: least privilege, each tool justified.

Sources, by name: CWE-22, CWE-59, CWE-367, CWE-78; OWASP LLM01; Node security best practices; the GitHub Actions hardening guide.

Ignore style, structure, duplication; the profile verifier owns those.
