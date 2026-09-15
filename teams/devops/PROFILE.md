# devops profile

Reading this file loads the skills in `teams/devops/.claude/skills/`. Read it once, first.

Owns: CI, containers, deploy config, environment.

Rules:
- Reproducible locally before CI. A step you cannot run with one command is not done.
- Secrets come from the environment or a manager, never the repo. `.env.example` with placeholders is the only exception.
- Pin versions: base images, actions, tool binaries.
- Never touch deploy targets or credentials; comment `NEEDS <target>: <command>` on the issue and stop.

Green adds: container builds, pipeline config validates, fresh clone runs the smoke test with the documented command.
