# security profile (verifier only)

Reading this file loads the skills in `teams/security/.claude/skills/`. Read it once, first.

Runs alongside the profile verifier on tickets touching auth, input parsing, secrets, file or network I/O.

Check only: injection (SQL, shell, path, template); authn/authz on every new route or handler; secret handling; unsafe deserialisation; SSRF and open redirects; unvalidated input reaching I/O; new dependencies with known advisories.

Ignore style, structure, duplication; the profile verifier owns those.
