# security profile (verifier only)

Reading this file loads the skills in `teams/security/.claude/skills/`. Read it once, first.

Runs alongside the profile verifier on tickets touching auth, input parsing, secrets, file or network I/O.

First, mechanical: `semgrep --config p/owasp-top-ten --config p/secrets --json --quiet $(gh pr diff <pr> --name-only)`; every finding is a numbered item in the verdict. Missing semgrep → note once, continue. New dependency in the diff → OSV query per `references/enforcement.md` §8.

Then read. Check only: injection (SQL, shell, path, template); authn/authz on every new route or handler; secret handling; unsafe deserialisation; SSRF and open redirects; unvalidated input reaching I/O.

Ignore style, structure, duplication; the profile verifier owns those.
