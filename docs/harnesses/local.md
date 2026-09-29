# Local-model coding harnesses vs hivemind's Claude Code dependencies

Research date 2026-09-29. Read-only; sources are official docs (docs sites and docs dirs in each repo), repo source, releases, GitHub issues.
Shallow clones used for source reading live in /tmp/harness-research/{oc-repo,goose-repo,crush-repo,aider-repo}; raw docs copies in /tmp/harness-research/src.

Versions seen: OpenCode v1.18.33 (2026-09-28, repo now `anomalyco/opencode`, `sst/opencode` redirects); Goose v1.52.0 (2026-09-23, repo now `aaif-goose/goose`, `block/goose` redirects); Crush v0.97.1 (2026-09-29); Aider v0.86.0 (2025-08-09, last commit on main 2026-05-22).
Confidence: H = read in official docs or source at the URL; M = inferred from source/issues; UNCONFIRMED = not verified.

---------------------------------------------------------------------------
## 1. OpenCode (main target)

Docs base: https://opencode.ai/docs/ (raw MDX: https://github.com/anomalyco/opencode/tree/dev/packages/web/src/content/docs). Docs banner mentions "OpenCode v2", but https://opencode.ai/v2 only redirects to the docs (v2 content UNCONFIRMED); hook API below is from `packages/plugin/src/index.ts` on `dev` (2026-09-28).

| # | Feature | Equivalent | Mechanism | Conf | Source |
|---|---|---|---|---|---|
| 1a | Global + per-repo instructions | YES (AGENTS.md) | Walks up from cwd for `AGENTS.md` (falls back to `CLAUDE.md` only if no AGENTS.md); global `~/.config/opencode/AGENTS.md`, then `~/.claude/CLAUDE.md` fallback. First match wins per category (does not stack ancestors). `instructions: [globs, URLs]` in opencode.json adds more files (remote fetch 5s timeout). Disable Claude fallbacks: `OPENCODE_DISABLE_CLAUDE_CODE[_PROMPT\|_SKILLS]=1` | H | https://opencode.ai/docs/rules/ |
| 1b | Nested per-directory files | YES | `src/session/instruction.ts` `resolve`: when a file is read, walks upward from that file and attaches nearby instruction files once per message | H (source) | https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/session/instruction.ts |
| 1c | On-demand skills | YES, near-identical | `skill` tool; `SKILL.md` with `name` + `description` frontmatter in `.opencode/skills/<n>/`, `~/.config/opencode/skills/`, and ALSO `.claude/skills/`, `~/.claude/skills/`, `.agents/skills/`, `~/.agents/skills/`. Agents see the list, load full body on demand. `permission.skill` allow/ask/deny with globs | H | https://opencode.ai/docs/skills/ |
| 1d | Custom slash commands | YES | `.opencode/commands/*.md` (or `command` in opencode.json: `template`, `description`, `agent`, `model`, `subtask`). Placeholders `$ARGUMENTS`, `$1..$n`; shell output / file refs supported (not re-verified for exact syntax). `subtask: true` forces subagent run | H | https://opencode.ai/docs/commands/ |
| 2 | Hooks / plugins running local code | YES (JS/TS, not shell) | Module in `.opencode/plugins/` or `~/.config/opencode/plugins/` or npm via `plugin` config; export async fn `({project, directory, worktree, client, serverUrl, $})` returning hooks. Load order: global cfg, project cfg, global dir, project dir; all hooks run in sequence. See 1.1 below | H | https://opencode.ai/docs/plugins/ ; plugin/src/index.ts |
| 3a | Subagents spawnable by main agent | YES | `task` tool with `subagent_type`; parallel by multiple task calls in one message; `background: true` param returns immediately and notifies later (in task.ts); `task_id` resumes a child session. Built-in `general`, `explore` + hidden compaction/title/summary agents | H | https://opencode.ai/docs/agents/ ; packages/opencode/src/tool/task.ts, task.txt |
| 3b | Agent definitions in files | YES | Markdown w/ YAML frontmatter in `.opencode/agents/` or `~/.config/opencode/agents/` (also `agent` key in opencode.json). Fields: `description`, `mode` (primary/subagent/all), `model`, `temperature`, `steps` (max iterations), `permission`, `hidden`, `prompt`, `color`. Body is system prompt | H | https://opencode.ai/docs/agents/ |
| 3c | Different model per subagent | YES | `model: provider/model-id` in agent file. If unset, a subagent inherits the invoking primary agent's model. So a cloud lead + local-32B worker works: worker agent pins `ollama/qwen...` | H | https://opencode.ai/docs/agents/#model |
| 3d | Per-subagent tool restrictions | YES | `permission` per agent: keys read/edit/glob/grep/bash/task/skill/webfetch/... with allow/ask/deny and glob-pattern objects (bash by command pattern, last match wins). Wildcards cover MCP tools (`"mymcp_*": "deny"`). `permission.task` limits which subagents an agent may spawn. Old `tools:` bool is deprecated | H | https://opencode.ai/docs/agents/#permissions ; https://opencode.ai/docs/permissions/ |
| 3e | Git worktree isolation per subagent | NO (built-in) / workaround YES | Task tool has no worktree option (open request: task subagents in a caller-selected directory, issue #46424). Workaround: the server takes per-request `x-opencode-directory` header / `directory` query (sdk/js/src/v2/client.ts), so an external orchestrator can run one session per worktree; or `opencode run --dir <worktree>` | M | https://github.com/anomalyco/opencode/issues/46424 ; packages/sdk/js/src/v2/client.ts |
| 4 | Structured multiple-choice question to user | YES | `question` tool (permission key `question`): header, question text, list of options, user picks or types custom answer; multi-question navigation. Reply also reachable via TUI/server | H | https://opencode.ai/docs/tools/#question |
| 5 | Customizable status line | NO | `tui.json` has theme, keybinds, scroll, cursor, mouse, `attention` (notifications/sounds). No status-line command hook found | H (absence in docs) | https://opencode.ai/docs/tui/ |
| 6 | MCP + extension system | YES | `mcp` in opencode.json: `type: local` (`command: [..]`, `environment`, `enabled`) or `type: remote` (`url`, headers, OAuth); `opencode mcp add/auth`, dynamic add via `POST /mcp`. Plugins can add tools (`tool()` helper w/ zod) and `custom-tools` dir; plugin tools override built-ins of same name | H | https://opencode.ai/docs/mcp-servers/ ; /docs/custom-tools/ |
| 7 | Providers / local models | YES | AI SDK + models.dev, 75+ providers. Local = custom provider with `npm: @ai-sdk/openai-compatible`, `options.baseURL`, `models` map. Docs have sections for Ollama (`http://localhost:11434/v1`; tip: raise `num_ctx` to 16-32k if tool calls fail), llama.cpp (llama-server), LM Studio. Model expression `provider/model-id`; `small_model` for titles | H | https://opencode.ai/docs/providers/ (Ollama / llama.cpp / LM Studio sections) ; /docs/models/ |
| 7b | Current model exposed to plugins | YES | `chat.message` input `{sessionID, agent, model:{providerID,modelID}, messageID, variant}`; `chat.params` input has full `model`, `provider`, `agent`; `experimental.chat.system.transform` input `{sessionID?, model}`; `experimental.compaction.autocontinue` input has model/agent. NOT in tool.execute.* payloads | H (source) | packages/plugin/src/index.ts |
| 8 | Headless / JSON / server / SDK | YES, strongest of the four | `opencode run "msg"` with `--format json` (raw JSON events), `--model p/m`, `--agent`, `--session/-s`, `--continue`, `--fork`, `--dir`, `--file`, `--attach http://host:4096`, `--auto` (auto-approve anything not denied), `--variant`, `--title`, `--command`. `opencode serve [--port 4096 --hostname]`, basic auth via `OPENCODE_SERVER_PASSWORD`; OpenAPI 3.1 spec; SSE `GET /event` (first event `server.connected`) and `/global/event`. REST: `POST /session` (body `{parentID,title}`), `POST /session/:id/message` (sync; body `{model,agent,noReply,system,tools,parts}`), `POST /session/:id/prompt_async` (204), `/command`, `/shell`, `/abort`, `/fork`, `/revert`, `/summarize`, `/diff`, `/children`, `/todo`, `POST /session/:id/permissions/:permissionID` (respond to a permission), `GET /agent`, `GET/POST /mcp`. JS SDK `@opencode-ai/sdk` (`createOpencode()`, `createOpencodeClient({baseUrl})`), typed; `session.prompt` supports structured output (`format` JSON schema -> `info.structured_output`). An external orchestrator CAN drive sessions, pick model+agent per message, stream events and answer permission requests | H | https://opencode.ai/docs/cli/ ; /docs/server/ ; /docs/sdk/ |
| 9 | Session storage, tokens, compaction | YES | SQLite DB (`opencode db path`, `opencode db <query> --format json`), data dir `~/.local/share/opencode/`; `opencode export/import/session list`. Assistant message + `step-finish` part carry `cost` and `tokens {input, output, reasoning, cache{read,write}}` (SDK types.gen.ts). Compaction: hidden `compaction` agent auto-summarizes when context is full; config `compaction {auto (default true), prune (default false), reserved}`; env `OPENCODE_DISABLE_AUTOCOMPACT`. Plugin hooks `experimental.session.compacting` (`output.context.push` / `output.prompt` replace) and `experimental.compaction.autocontinue` (`enabled=false` skips synthetic "continue" turn); events `session.compacted` | H | https://opencode.ai/docs/config/#compaction ; https://opencode.ai/docs/troubleshooting/ ; sdk types.gen.ts |
| 10 | Commit attribution / co-author | NO setting | No config key found in docs or source. System prompt says never commit unless asked (session/prompt/default.txt). Only `opencode github` handler adds `Co-authored-by` for the GitHub actor. So no trailer is added by the tool; hivemind's own instruction can add one | H (absence via grep of packages/opencode/src) | packages/opencode/src/session/prompt/default.txt ; src/cli/cmd/github.handler.ts |
| 11 | Permission model | YES, closer to Claude than Goose/Aider | `permission` config: `read/edit/glob/grep/bash/task/skill/lsp/question/webfetch/websearch/external_directory/doom_loop`; values allow/ask/deny; object form with glob patterns, last match wins; bash matched on parsed commands (`git *`). Defaults mostly allow; `external_directory` and `doom_loop` ask; `.env` reads denied. `--auto` flag / `OPENCODE_PERMISSION` env (inline JSON). Ask outcomes once/always/reject. Plugin hook `permission.ask` (output.status) can auto-decide. No OS sandbox | H | https://opencode.ai/docs/permissions/ |

### 1.1 OpenCode plugin API precisely
Source: https://github.com/anomalyco/opencode/blob/dev/packages/plugin/src/index.ts (dev, 2026-09-28) and https://opencode.ai/docs/plugins/.

Plugin fn input (`PluginInput`): `client` (SDK client), `project`, `directory`, `worktree`, `serverUrl`, `$` (Bun shell), `experimental_workspace`. Returns `Hooks`:

| Hook | input | output (mutable) | Claude Code analogue / note |
|---|---|---|---|
| `event({event})` | any bus event | - | Bus events: session.created/compacted/deleted/diff/error/idle/status/updated; message.updated/removed, message.part.updated/removed; permission.*; file.*; todo.updated; tui.*; etc. `session.idle` ~ Stop (fires AFTER loop ended; cannot veto) |
| `chat.message` | `{sessionID, agent?, model?{providerID,modelID}, messageID?, variant?}` | `{message: UserMessage, parts: Part[]}` | UserPromptSubmit; can mutate/append parts (inject text) |
| `chat.params` / `chat.headers` | `{sessionID, agent, model, provider, message}` | temperature/topP/topK/maxOutputTokens/options ; headers | sampling control per request |
| `tool.execute.before` | `{tool, sessionID, callID}` | `{args}` (mutable) | PreToolUse. THROW an Error to block; message is returned to the model (docs example `.env` guard). No `cwd`/agent name/model in payload |
| `tool.execute.after` | `{tool, sessionID, callID, args}` | `{title, output, metadata}` | PostToolUse (failure signalling undocumented) |
| `permission.ask` | Permission | `{status: ask\|deny\|allow}` | auto-answer permission prompts |
| `command.execute.before` | `{command, sessionID, arguments}` | `{parts}` | slash command interception |
| `shell.env` | `{cwd, sessionID?, callID?}` | `{env}` | inject env into bash tool |
| `experimental.chat.system.transform` | `{sessionID?, model}` | `{system: string[]}` | SessionStart-style injection of text into the system prompt (every request, not once); issue #50133 maps it to SessionStart |
| `experimental.chat.messages.transform` | `{}` | `{messages[]}` | rewrite full history before send |
| `experimental.session.compacting` | `{sessionID}` | `{context: string[], prompt?}` | PreCompact; append context or replace prompt |
| `experimental.compaction.autocontinue` | `{sessionID, agent, model, provider, message, overflow}` | `{enabled}` | after compaction |
| `experimental.text.complete` | `{sessionID, messageID, partID}` | `{text}` | post-process assistant text |
| `tool.definition` | `{toolID}` | `{description, parameters}` | edit tool schemas sent to model |
| `tool`, `auth`, `provider`, `config`, `dispose` | - | - | register tools/providers, mutate config |

GAPS vs Claude Code (from issue https://github.com/anomalyco/opencode/issues/50133, 2026-09-20, open): no cwd in tool hooks; no per-agent hooks (enforcement is one global plugin matching agent name); no PostToolUseFailure signal; no Notification event; no model-switch events.
Stop-with-force-continue is NOT native: `session.idle` fires after the loop ends, so a plugin must re-prompt via `client.session.prompt/promptAsync`, which shows as a visible user message and can race process teardown in `opencode run` (issue #16626 open, proposing `session.stopping`; #47300 also open). Workable when hivemind runs against `opencode serve` (long-lived); fragile under `opencode run`.
Reliability warnings: issue #41422 (open, v1.18.15) reports `tool.execute.before/after` not firing under headless `opencode run` for plugin-provided tools (unconfirmed by maintainers); #41234 a single non-function named export silently disables a whole plugin; #37164 (open) tool.execute.before cannot request native approval. Plugin hooks for MCP tools were fixed (#2319/#2320, closed). Whether the hook fires inside child (task) sessions is not documented (UNCONFIRMED; source shows same tool pipeline, issue #50133 says SubagentStart/Stop maps to `task` before/after).

### 1.2 Hivemind mapping summary (OpenCode)
- Lead+worker+verifier: agents in `.opencode/agents/*.md` with `model`, `permission`, `mode: subagent`; lead calls `task`. YES.
- Hard guard (block edits outside owned paths): `permission.edit` glob object per agent covers most of it declaratively; `tool.execute.before` throw covers the rest.
- Worktrees: orchestrate externally (one `opencode serve` + `x-opencode-directory` per worktree, or `opencode run --dir`), not via the task tool.
- Skill reuse: OpenCode reads `.claude/skills/` and `~/.claude/skills/` and `~/.claude/CLAUDE.md` directly, so the existing hivemind skill and CLAUDE.md are visible unchanged (skill frontmatter fields beyond name/description ignored - UNCONFIRMED which).
- State in GitHub issues: needs only bash/gh, unchanged.

---------------------------------------------------------------------------
## 2. Goose (aaif-goose/goose, formerly block/goose)

Docs source: https://github.com/aaif-goose/goose/tree/main/documentation/docs (site goose-docs.ai). v1.52.0, 2026-09-23. Rust core; CLI + Desktop; ACP server.

| Feature | Equivalent | Mechanism | Conf | Source |
|---|---|---|---|---|
| Instructions | YES | `AGENTS.md` and `.goosehints` (default `CONTEXT_FILE_NAMES=[".goosehints","AGENTS.md"]`), global `~/.config/goose/.goosehints`, nested loading at each directory level; `CONTEXT_FILE_NAMES` env to add CLAUDE.md etc. | H | documentation/docs/guides/context-engineering/using-goosehints.md ; guides/environment-variables.md |
| Skills | YES | Built-in Skills extension: names/descriptions injected at session start, body loaded on demand; `goose skills list`, CLI `/skills a b`; Agent Skills compatible; (search paths incl. .claude/skills not verified) | H / M | guides/context-engineering/using-skills.md |
| Custom commands | PARTIAL | Slash commands are aliases to recipes (YAML), not free-form markdown prompts | H | guides/context-engineering/slash-commands.md |
| Hooks | YES, closest to Claude Code | Open Plugins spec: `<project>/.agents/plugins/<name>/hooks/hooks.json` or `~/.agents/plugins/`. Events: SessionStart, SessionEnd, Stop, UserPromptSubmit, PreToolUse, PostToolUse, PostToolUseFailure, BeforeReadFile, AfterFileEdit, BeforeShellExecution, AfterShellExecution (+ PreToolUseResult observation). Command gets JSON on stdin: `event, session_id, tool_name, tool_input, tool_call_id, message (prompt), last_assistant_message (Stop), working_dir, matcher_context`. `matcher` regex; `timeout`; `on_failure: block`. PreToolUse blocks via exit 2 (stderr = reason) or stdout `{"decision":"block","reason":..}`; Stop block forces the turn to continue (capped by `GOOSE_STOP_HOOK_BLOCK_CAP`). Only PreToolUse and Stop can block; SessionStart/UserPromptSubmit are observation-only (cannot inject text). No PreCompact. No model/transcript field in payload | H | guides/context-engineering/hooks.md ; blog/2026-05-14-goose-hooks |
| Subagents | YES, with caveats | Main agent spawns via natural language / recipes; sequential or parallel; 5-min default timeout; DISABLED in manual/smart approval permission modes (only autonomous). Custom agents: markdown + frontmatter `name, description, model` in `.agents/agents/`, `~/.agents/agents/` (also reads `.claude/agents/`, `.goose/agents/`). Model per subagent: agent `model`, recipe `settings.goose_provider/goose_model`, or env `GOOSE_SUBAGENT_PROVIDER/MODEL`; `GOOSE_SUBAGENT_MAX_TURNS`. Tool restriction: by extension set per subagent ("only the developer extension"). Worktree isolation: none (UNCONFIRMED, only an env-var doc hint) | H | guides/context-engineering/subagents.mdx ; custom-agents.md ; recipes/recipe-reference.md |
| Question tool | PARTIAL | MCP Elicitation forms (extension asks user); no built-in multiple-choice tool found | M | guides/mcp-elicitation.md |
| Status line | NO (not found) | | M | grep of docs+crates |
| MCP / extensions | YES | Extensions = MCP servers (stdio/HTTP), plus plugins dir; MCP roots, elicitation, MCP-UI | H | guides/mcp-roots.md etc. |
| Providers | YES | Ollama (`OLLAMA_HOST`, models auto-listed), custom providers with OpenAI/Anthropic/Ollama-compatible APIs (vLLM, LM Studio via OpenAI compat), and a `goose-local-inference` crate | H | getting-started/providers.md |
| Headless | YES | `goose run -t/-i/--recipe`, `--output-format text\|json\|stream-json`, `--provider --model --max-turns --no-session -q`; `goose serve` (ACP server, port 3284, secret key, TLS); `goose acp` | H | guides/goose-cli-commands.md ; guides/remote-goose-server.md |
| Sessions | YES | SQLite `~/.local/share/goose/sessions/sessions.db`; auto-compaction at 80% of context by default | H | guides/logs.md ; guides/sessions/smart-context-management.md |
| Commit attribution | NO setting | none found | M | grep |
| Permissions | PARTIAL | 4 modes: autonomous (default), manual approval, smart approval, chat-only; per-tool permissions; no path-glob rules | H | guides/managing-tools/goose-permissions.md |

## 3. Crush (charmbracelet/crush)

v0.97.1 (2026-09-29). Docs: README.md, docs/hooks/README.md, schema.json at https://github.com/charmbracelet/crush. Go, single-agent oriented.

| Feature | Equivalent | Mechanism | Conf | Source |
|---|---|---|---|---|
| Instructions | YES | Reads AGENTS.md / CRUSH.md / CLAUDE.md-style names via `options.context_paths`; global `~/.config/crush/CRUSH.md` and `~/.config/AGENTS.md` (`global_context_paths`) | H | README.md "Global context files"; internal/config/config.go |
| Skills | YES | Agent Skills (SKILL.md); global dirs incl. `~/.claude/skills`, `~/.agents/skills`, `~/.config/crush/skills`; project `.agents/skills`, `.crush/skills`, `.claude/skills`, `.cursor/skills`; user-invocable from commands palette; `disabled_skills` | H | README.md "Agent Skills" |
| Hooks | PARTIAL: PreToolUse only | `hooks.PreToolUse[]` in crush.json: `{name, matcher (regex on tool name), command, timeout (default 30s)}`. Env `CRUSH_EVENT, CRUSH_TOOL_NAME, CRUSH_SESSION_ID, CRUSH_CWD, CRUSH_PROJECT_DIR, CRUSH_TOOL_INPUT_COMMAND, CRUSH_TOOL_INPUT_FILE_PATH` + JSON on stdin (includes session_id, raw tool_input). Exit 2 blocks with stderr as reason; JSON result can allow/deny, `updated_input` rewrite, inject context. Claude Code compatible format. No session start, prompt, stop, compaction hooks | H | docs/hooks/README.md |
| Subagents | NO (practically) | `agent` tool = built-in read-only search agent (glob, grep, ls, view); no user-defined agents, no per-agent model beyond global large/small model | H | internal/agent/templates/agent_tool.md |
| Question tool | YES | `question` tool: types yes_no / single_choice / multi_choice / free_text, max 5 choices, description required, multi-question tabbed form | H | internal/agent/tools/question.md |
| Status line | NO | | M | |
| MCP | YES | stdio/http/sse, OAuth | H | README.md |
| Providers | YES | Ollama/OpenAI-compatible (`provider add ollama --type ollama --base-url ...`), catwalk registry; large + small model config | H | README.md |
| Headless | PARTIAL | `crush run` (flags -m, --small-model, -s, -C continue, -q); no JSON output flag found; `crush serve` HTTP+SSE server with workspaces/sessions/messages API (`/v1/workspaces/{id}/sessions...`) | H / M | internal/cmd/run.go ; internal/server/endpoints.go |
| Sessions | YES | SQLite (internal/db), auto summarize (`disable_auto_summarize`) | M | schema.json |
| Commit attribution | YES | `options.attribution.trailer_style` = none / co-authored-by / assisted-by (default assisted-by); `generated_with` bool | H | schema.json |
| Permissions | YES (coarse) | Prompt by default; `permissions.allowed_tools`; `crush permissions allow/deny`; `--yolo`; hooks can auto-approve | H | README.md |

## 4. Aider (Aider-AI/aider)

v0.86.0 (2025-08-09); main last touched 2026-05-22 (maintenance pace; no release in ~13 months as of today).

| Feature | Equivalent | Mechanism | Conf | Source |
|---|---|---|---|---|
| Instructions | PARTIAL | No native AGENTS.md; `/read CONVENTIONS.md` or `--read`, `.aider.conf.yml` `read:` | H | aider/website/docs/usage/conventions.md |
| Skills / commands | NO / built-in only | Fixed slash commands (/ask /architect /code ...) | H | docs/usage/commands.md |
| Hooks | NO | only `--notifications-command`, `--lint-cmd`, `--test-cmd` | H | docs/usage/notifications.md, lint-test.md |
| Subagents | NO | Architect/editor two-model split within one session (different models: yes) | H | docs/usage/modes.md |
| Question tool / status line / MCP | NO / NO / NO (no MCP docs found) | | M | |
| Providers | YES | LiteLLM; Ollama, LM Studio, OpenAI-compatible | H | docs/llms/ollama.md, lm-studio.md, openai-compat.md |
| Headless | PARTIAL | `--message`, `--message-file`, `--yes-always`; Python scripting API; no JSON event stream, no server | H | docs/scripting.md |
| Sessions | PARTIAL | `.aider.chat.history.md`, `--llm-history-file`; no token JSON per message | M | |
| Attribution | YES | `--attribute-author/committer`, `--attribute-co-authored-by`, commit-message prefix | H | docs/git.md, config/options.md |
| Permissions | NO real model | `--yes-always`, confirmations for shell | M | |

---------------------------------------------------------------------------
## 5. Local models for agentic tool calling (only what is citable)

- Aider polyglot leaderboard data, LAST ENTRY 2025-10-03 (stale for 2026): Qwen3-32B 40.0% (diff), gpt-oss-120b (high) 41.8%, Qwen2.5-Coder-32B 16.4% (whole) / 8.0% (diff), gemma-3-27b 4.9%, Llama 4 Maverick 15.6%; large open models: DeepSeek-V3.2-Exp Reasoner 74.2%, R1-0528 71.4%, Kimi K2 59.1%, Qwen3-235B-A22B 59.6%. Source: https://github.com/Aider-AI/aider/blob/main/aider/website/_data/polyglot_leaderboard.yml
- Berkeley Function-Calling Leaderboard CSV (https://gorilla.cs.berkeley.edu/data_overall.csv, fetched 2026-09-29; snapshot appears to date from ~Nov/Dec 2025 because top entry is Claude Opus 4.5; exact update date UNCONFIRMED). Open-weight, overall acc / multi-turn: GLM-4.6 FC thinking 72.4 / 68.0 (large); Kimi-K2-Instruct 59.1 / 50.6; Qwen3-235B-A22B-Instruct-2507 52.2 (prompt) / 44.6; xLAM-2-32b-fc-r 54.7 / 69.5 (cc-by-nc); Qwen3-32B FC 48.7 / 47.9; Arch-Agent-32B 45.4 / 54.3; Qwen3-8B FC 42.6 / 41.8; Qwen3-30B-A3B-Instruct-2507 FC 41.4 / 30.0; Qwen3-14B FC 41.0 / 34.8; Qwen3-4B-Instruct-2507 FC 35.7 / 22.1; Llama-3.3-70B FC 31.9 / 21.5; Gemma-3-27b (prompt) 29.5 / 10.8; Phi-4 28.8 / 3.9; Llama-3.1-8B 25.8. Reading: within sub-40B open models, Qwen3 family (FC mode) is the best-scoring cited option; Gemma/Phi/Llama are weak on multi-turn. Newer 2026 local models (e.g. Qwen3-Coder, Devstral, gpt-oss-20b, Qwen3.5) are NOT in this snapshot: UNCONFIRMED for them.
- SWE-bench Verified with open small/mid models: not fetched; UNCONFIRMED.
- Harness-specific: OpenCode docs advise raising Ollama `num_ctx` to 16-32k when tool calls fail (https://opencode.ai/docs/providers/); no harness-specific local-model benchmark found.

---------------------------------------------------------------------------
## 6. Ranking as hivemind targets

1. OpenCode - only one with file-defined subagents + per-agent model + per-agent permission globs + parallel/background task tool, JS plugin blocking hook, server/SDK for external orchestration, and it already reads `.claude/skills`, `CLAUDE.md`. Gaps: no native Stop-veto, no worktree per subagent, no co-author setting, hooks lack cwd/agent.
2. Goose - best hook parity (shell hooks, PreToolUse block, Stop force-continue, JSON stdin), custom agents with model, `goose serve`/ACP. Gaps: subagents only in autonomous mode (no approval safety), no path-glob permissions, hooks cannot inject context, question/status line absent.
3. Crush - good ask-user tool, attribution setting, Claude-compatible PreToolUse (can rewrite/inject), skills, server; but no real subagents and only one hook event.
4. Aider - stale release cadence, no hooks/subagents/MCP/skills/server; fine only as a single-worker editor invoked by `--message`.
