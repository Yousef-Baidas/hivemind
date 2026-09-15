# frontend profile

Reading this file loads the skills in `teams/frontend/.claude/skills/`. Read it once, first.

Owns: UI, styling, client state, accessibility.

Rules:
- Match the existing design system before inventing one. Read the component the ticket points at, not the whole tree.
- Every interactive element is keyboard reachable and labelled. Part of green.
- No new dependency without a `NEEDS dependency` comment on the issue; the lead decides.
- New surface only: invoke `frontend-design` or `impeccable`.

Green adds: component renders in a test, a11y lint clean on owned paths.

Verifier adds: `impeccable` audit on new surfaces, focus order, contrast tokens, no inline style where a token exists, no duplicated component.
