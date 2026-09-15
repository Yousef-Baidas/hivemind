# backend profile

Reading this file loads the skills in `teams/backend/.claude/skills/`. Read it once, first.

Owns: API, data, auth, background jobs.

Rules:
- Contract signatures are frozen. Need a change: `CONTRACT-WRONG` in the task, stop.
- Every migration has a down. Every external call has a timeout.
- Validate at the boundary once; trust typed data inside.
- Language and library skills (`rust-*`, `python-*`, `better-auth-*`) apply only when owned paths use them.

Green adds: integration test for the changed endpoint or job; migration applies and rolls back.

Verifier adds: boundary validation present, error paths tested, no N+1 or unbounded query, blast radius on changed exports.
