# workflow craft

How to write the text agents read: skills, agent files, profiles, docs. Sources: Anthropic Agent Skills overview and best practices; Claude Code subagents and hooks docs; OpenAI Codex skills and AGENTS.md docs; Diátaxis; the Google developer documentation style guide.

## Skills

- A skill is a folder with `SKILL.md`. Frontmatter carries `name` (lowercase, hyphens, matches the folder) and `description`.
- The description says what the skill does and when to use it, in third person. `name` and `description` are the only parts loaded before the skill triggers, so the trigger words go in the description.
- Keep `SKILL.md` short; move detail into files it links one level deep, loaded on demand.
- Scripts a skill bundles are run, not read; say so, and say how to call them.

## Codex skill semantics

- Codex reads the same `SKILL.md` format from `.agents/skills/` and `~/.agents/skills/`. It does not load a nested skill folder on its own; a worker opens the file it needs.
- `agents/openai.yaml` inside the skill folder holds Codex-only metadata (display name, icons, invocation policy). The skill body never depends on it.
- `AGENTS.md` is the Codex counterpart of `CLAUDE.md`: read at session start, nearest file wins. Keep it to commands and rules an agent cannot infer.

## Agent files

- Frontmatter: `name`, `description`, and `tools` listing each tool the agent may call. An agent with no tools list inherits all of them; say so on purpose or list them.
- The description tells the lead when to delegate. The body is the agent's system prompt. The agent also gets the lead's task prompt and `CLAUDE.md`, never the lead's conversation.

## Prose

- One page, one purpose: tutorial, how-to, reference or explanation (Diátaxis). Do not mix them.
- Active voice, present tense, second person for instructions. Short sentences. Put the condition before the instruction.
- One term per concept, from `CONTEXT.md`. Do not alias.
- A repo path in backticks exists in `git ls-files`, or the text names the ticket that creates it; check before you commit.
- State each behaviour once, where the code does it, and link to it from elsewhere.
