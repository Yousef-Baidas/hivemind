// OpenAI Codex CLI adapter (0.159): maps Codex's hook JSON to the hive event (see hive-harness.js),
// reads its rollout transcripts, and registers the hooks in .codex/hooks.json. Codex's hook
// answers copy Claude Code's (exit 2 + stderr, permissionDecision, additionalContext, decision
// "block"), so those come from the Claude adapter.
//
// Gaps against Claude Code, each a rule the hooks cannot enforce here:
//   - a shell call's background mode (yield_time_ms) is not in the hook input: background=false
//   - no failed-tool event, no teammate idle event, no running-task list on SubagentStop
//   - no scriptable status line
"use strict";
const fs = require("fs");
const path = require("path");
const os = require("os");
const { tailLines } = require(path.join(__dirname, "hive-lib.js"));
const claude = require(path.join(__dirname, "hive-harness-claude.js"));

const name = "codex";
// no default ladder: single-model mode (the lead's model) until models.ladder names the rungs
const models = null;
const bypass = "HIVEMIND=0 codex";

const KINDS = {
  SessionStart: "session-start",
  UserPromptSubmit: "prompt",
  PreToolUse: "pre-tool",
  PostToolUse: "post-tool",
  Stop: "stop",
  SubagentStop: "subagent-stop",
};
// tool_name is always the canonical name; Edit, Write and Agent are matcher aliases only.
// Multi-agent v2 prefixes its tools with a namespace ("collaborationspawn_agent" by default, and
// configurable), so a spawn is any name ending in spawn_agent.
const TOOLS = { apply_patch: "edit", Bash: "shell", view_image: "read" };
const toolKind = (name) => TOOLS[name] || (/spawn_agent$/.test(String(name || "")) ? "spawn" : "");

// hooks get no project-dir variable; a hook installed in <root>/.codex/hooks knows its root
const installedRoot = () => (path.basename(path.dirname(__dirname)) === ".codex" ? path.dirname(path.dirname(__dirname)) : "");
const projectRoot = (raw) => process.env.HIVE_PROJECT_DIR || installedRoot() || (raw && raw.cwd) || process.cwd();

// every file a patch touches: "*** Add File: p", "*** Update File: p", "*** Delete File: p", "*** Move to: p"
const PATCH_FILE = /^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+?)\s*$/gm;
function patchPaths(text, cwd) {
  const out = [];
  for (const m of String(text).matchAll(PATCH_FILE)) out.push(cwd ? path.resolve(cwd, m[1]) : m[1]);
  return out;
}
// the model may also run apply_patch through the shell; that is still an edit
const SHELL_PATCH = /^\s*apply_patch\b[\s\S]*\*\*\* Begin Patch/;

function event(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const ti = r.tool_input && typeof r.tool_input === "object" ? r.tool_input : {};
  const cmd = typeof ti.command === "string" ? ti.command : "";
  let tool = toolKind(r.tool_name);
  if (tool === "shell" && SHELL_PATCH.test(cmd)) tool = "edit";
  const img = ti.path || ti.file_path || ti.image_path || "";
  const paths = tool === "edit" ? patchPaths(cmd, r.cwd) : tool === "read" && img ? [r.cwd ? path.resolve(r.cwd, img) : img] : [];
  return {
    kind: KINDS[r.hook_event_name] || "",
    session: r.session_id || "",
    cwd: r.cwd || "",
    root: projectRoot(r),
    source: r.source || "",
    agent: r.agent_id || "",
    agentType: r.agent_type || "",
    teammate: "",
    model: typeof r.model === "string" ? r.model : "",
    tool,
    toolName: r.tool_name || "",
    toolUseId: r.tool_use_id || "",
    path: paths[0] || "",
    paths,
    command: tool === "shell" ? cmd : "",
    background: false,
    spawnModel: typeof ti.model === "string" ? ti.model : "",
    prompt: typeof r.prompt === "string" ? r.prompt : "",
    fromHuman: true, // UserPromptSubmit fires for submitted user input only
    output: outputText(r.tool_response),
    error: "",
    stopActive: r.stop_hook_active === true,
    busy: false,
    raw: r,
  };
}

// Bash: one merged string; other tools: the model-facing output, a string or content items
function outputText(res) {
  if (typeof res === "string") return res;
  if (Array.isArray(res)) return res.map((c) => (c && typeof c.text === "string" ? c.text : "")).filter(Boolean).join("\n");
  return res && typeof res === "object" && typeof res.output === "string" ? res.output : "";
}

const { deny, context, keepGoing } = claude;

// ---- rollouts: JSONL, {timestamp, type, payload}; each subagent has its own file

function* entriesBackward(lines) {
  for (let i = lines.length - 1; i >= 0; i--) {
    let e;
    try { e = JSON.parse(lines[i]); } catch { continue; }
    if (e && typeof e === "object" && e.payload && typeof e.payload === "object") yield e;
  }
}

// context size: the newest token_count's last_token_usage (after a compaction, Codex's estimate)
function contextTokens(ev) {
  const lines = tailLines(ev.raw.transcript_path).filter((l) => l.includes('"token_count"'));
  for (const e of entriesBackward(lines)) {
    const info = e.type === "event_msg" && e.payload.type === "token_count" && e.payload.info;
    const n = info && info.last_token_usage && +info.last_token_usage.total_tokens;
    if (n > 0) return n;
  }
  return 0;
}

const textOf = (c) => (typeof c === "string" ? c : Array.isArray(c)
  ? c.filter((b) => b && (b.type === "output_text" || b.type === "input_text" || b.type === "text") && typeof b.text === "string").map((b) => b.text).join("\n") : "");
const message = (e, role) => e.type === "response_item" && e.payload.type === "message" && e.payload.role === role;

function lastAssistantText(ev) {
  if (typeof ev.raw.last_assistant_message === "string") return ev.raw.last_assistant_message;
  for (const e of entriesBackward(tailLines(ev.raw.agent_transcript_path || ev.raw.transcript_path))) {
    if (e.type === "event_msg" && e.payload.type === "task_complete" && typeof e.payload.last_agent_message === "string") return e.payload.last_agent_message;
    if (!message(e, "assistant")) continue;
    const text = textOf(e.payload.content);
    if (text.trim()) return text;
  }
  return "";
}

// user-role text Codex injects itself: instructions, environment, skills, notifications
const INJECTED = /^\s*(# AGENTS\.md instructions|<(environment_context|environments_state|external_|skill|skills_instructions|user_shell_command|turn_aborted|subagent_notification|git_attribution|hook_prompt|agent_message_board|user_instructions))/;
function humanText(e) {
  const p = e.payload;
  if (e.type === "event_msg" && p.type === "user_message") return typeof p.message === "string" ? p.message : "";
  if (e.type === "event_msg" && p.type === "item_completed" && p.item && p.item.type === "UserMessage") return textOf(p.item.content);
  if (!message(e, "user")) return null;
  const kinds = p.internal_chat_message_metadata_passthrough && p.internal_chat_message_metadata_passthrough.content_item_kinds;
  if (Array.isArray(kinds) && kinds.length && !kinds.every((k) => String(k).startsWith("user."))) return "";
  const text = textOf(p.content);
  return INJECTED.test(text) ? "" : text;
}
// newest prompt the human typed; null when none is found or a compaction came since
function lastHumanPrompt(ev) {
  const lines = tailLines(ev.raw.transcript_path, 4 * 1024 * 1024)
    .filter((l) => l.includes('"compacted"') || l.includes('"user_message"') || l.includes('"UserMessage"') || l.includes('"role":"user"'));
  for (const e of entriesBackward(lines)) {
    if (e.type === "compacted") return null;
    const text = humanText(e);
    if (text && text.trim()) return text;
  }
  return null;
}

// every hook but SessionEnd carries the model; turn_context records it per turn
function sessionModel(ev) {
  if (ev.model) return ev.model;
  for (const e of entriesBackward(tailLines(ev.raw.transcript_path).filter((l) => l.includes('"turn_context"')))) {
    if (e.type === "turn_context" && typeof e.payload.model === "string" && e.payload.model) return e.payload.model;
  }
  return "";
}

// ---- install

const home = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
const skillDirs = (root) => [path.join(root, ".agents", "skills", "hivemind"), path.join(os.homedir(), ".agents", "skills", "hivemind")];
const agentsDir = path.join(home, "agents");
const hooksDir = (root) => path.join(root, ".codex", "hooks");

// an agent file in Codex's TOML. Never a model: a role's model overrides the spawn's, and the
// ladder picks the model per spawn. Tool limits do not carry over (roles cannot set them).
function agentFile(file, text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) return null;
  const field = (k) => { const f = new RegExp(`^${k}:\\s*(.*)$`, "m").exec(m[1]); return f ? f[1].trim().replace(/^(["'])(.*)\1$/, "$2") : ""; };
  const agent = field("name") || path.basename(file, ".md");
  const q = (s) => JSON.stringify(s); // a JSON string is a TOML basic string
  return {
    name: `${agent}.toml`,
    text: [`# generated by hivemind from ${path.basename(file)}; edits are overwritten`, `name = ${q(agent)}`, `description = ${q(field("description") || agent)}`,
      `developer_instructions = ${q(m[2].trim())}`, ""].join("\n"),
  };
}

// context-mode as an MCP server in the user's Codex config
function contextModeOn() {
  try { return /^\s*\[mcp_servers\.["']?context-mode["']?\]/m.test(fs.readFileSync(path.join(home, "config.toml"), "utf8")); } catch { return false; }
}

// [event, script, matcher, timeout s]; a matcher of only names and | is an exact-name list,
// anything else is an unanchored regex (the guard's catches every namespace's spawn_agent)
const LEAD_HOOKS = [
  ["SessionStart", "hive-autostart.js", undefined, 60],
  ["UserPromptSubmit", "hive-journal.js"],
  ["UserPromptSubmit", "hive-lessons.js"],
  ["PreToolUse", "hive-lead-guard.js", "^(apply_patch|Bash|view_image|[a-z_]*spawn_agent)$"],
  ["PreToolUse", "hive-lessons.js", "Bash|apply_patch|view_image"],
  ["PostToolUse", "hive-lessons.js", "Bash"],
  ["PreToolUse", "hive-scratch.js", "Bash"],
  ["PostToolUse", "hive-scratch.js", "Bash"],
  ["SubagentStop", "hive-stall.js"],
];

// The sandbox keeps .git (a worktree's gitdir too) read-only and the network off, so the git
// writes and gh calls hivemind makes run outside it by rule. Everything else stays sandboxed;
// reset, clean and other history rewrites still ask.
const RULES = `# generated by hivemind; edits are overwritten. Commands that run outside the sandbox.
prefix_rule(pattern=["git", ["add", "commit", "push", "fetch", "pull", "merge", "rebase", "checkout", "switch", "branch", "worktree", "tag", "stash", "restore", "cherry-pick", "revert", "rm", "mv"]], decision="allow", justification="hivemind: workers commit in linked worktrees; the lead merges and pushes")
prefix_rule(pattern=["gh"], decision="allow", justification="hivemind: the tracker is GitHub issues and PRs")
prefix_rule(pattern=["node", [".codex/hooks/hive-worktree.js", ".codex/hooks/hive-status.js", ".codex/hooks/hive-inbox.js", ".codex/hooks/hive-scratch.js"]], decision="allow", justification="hivemind: the lead's own scripts")
`;

// .codex/hooks.json (only adds; never removes a user hook) and .codex/rules/hivemind.rules.
// Codex skips a new or changed hook until the human trusts it in /hooks, once per command.
function registerLead(root) {
  const file = path.join(root, ".codex", "hooks.json");
  let raw = null;
  try { raw = fs.readFileSync(file, "utf8"); } catch {}
  let s = {};
  if (raw !== null && raw.trim()) {
    try { s = JSON.parse(raw); } catch (e) { return { file, error: `${file} is not valid JSON (${e.message})` }; }
    if (!s || typeof s !== "object" || Array.isArray(s)) return { file, error: `${file} is not a JSON object` };
  }
  const before = JSON.stringify(s);
  s.hooks = s.hooks && typeof s.hooks === "object" ? s.hooks : {};
  // hooks run from the turn's cwd through the user's login shell: an absolute, quoted path
  const cmd = (f) => `node "${path.resolve(hooksDir(root), f).split(path.sep).join("/")}"`;
  for (const [ev, script, matcher, timeout] of LEAD_HOOKS) {
    const list = (s.hooks[ev] = Array.isArray(s.hooks[ev]) ? s.hooks[ev] : []);
    if (list.some((e) => JSON.stringify((e && e.hooks) || []).includes(script) && (e.matcher || undefined) === matcher)) continue;
    const entry = { hooks: [{ type: "command", command: cmd(script), ...(timeout && { timeout }) }] };
    if (matcher) entry.matcher = matcher;
    list.push(entry);
  }
  let changed = JSON.stringify(s) !== before;
  if (changed) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(s, null, 2) + "\n");
  }
  const rules = path.join(root, ".codex", "rules", "hivemind.rules");
  let old = null;
  try { old = fs.readFileSync(rules, "utf8"); } catch {}
  if (old !== RULES) {
    fs.mkdirSync(path.dirname(rules), { recursive: true });
    fs.writeFileSync(rules, RULES);
    changed = true;
  }
  return { file, changed };
}

// Subagents run in the lead's session under its hooks, which enforce owned paths; the copies
// here are the backup for a codex session opened inside the worktree.
const WORKER_HOOKS = ["hive-lib.js", "hive-harness.js", "hive-harness-claude.js", "hive-harness-codex.js", "hive-owned-paths.js", "hive-worker-guard.js", "hive-stall.js", "hive-lessons.js", "hive-scratch.js"];
const WORKER_EXCLUDE = ["/.codex/hive-owned", "/.codex/hooks/hive-*.js"];
function prepareWorker(wt, src) {
  const dir = hooksDir(wt);
  fs.mkdirSync(dir, { recursive: true });
  for (const f of WORKER_HOOKS) fs.copyFileSync(path.join(src, f), path.join(dir, f));
  return WORKER_EXCLUDE;
}
// under .codex, which the sandbox keeps read-only for the worker itself
const ownedFile = (wt) => path.join(wt, ".codex", "hive-owned");

module.exports = {
  name, bypass, models, projectRoot, event, deny, context, keepGoing,
  contextTokens, lastAssistantText, lastHumanPrompt, sessionModel,
  home, skillDirs, agentsDir, hooksDir, agentFile, contextModeOn, registerLead, prepareWorker, ownedFile, LEAD_HOOKS,
  patchPaths, RULES,
};
