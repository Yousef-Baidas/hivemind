// Shared helpers for the hive-*.js hooks. Plain Node, no dependencies, no shell.
// Every hook fails open: an internal error exits 0 and never blocks the session.
"use strict";
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFileSync } = require("child_process");

// read the hook's stdin JSON, run main(ev); any throw or rejection exits 0
function run(main) {
  process.on("uncaughtException", () => process.exit(0));
  process.on("unhandledRejection", () => process.exit(0));
  let input = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (c) => (input += c));
  process.stdin.on("end", async () => {
    let ev = {};
    try { ev = JSON.parse(input) || {}; } catch {}
    try { await main(ev); } catch (e) { if (process.env.HIVE_DEBUG) process.stderr.write(`hive hook: ${e.stack}\n`); }
    // pipes are async on macOS: exit only once stdout has drained
    process.stdout.write("", () => process.exit(0));
  });
}

const projectRoot = (ev) => process.env.CLAUDE_PROJECT_DIR || (ev && ev.cwd) || process.cwd();

// linked worktree: .git is a file pointing at the main checkout
function isLinked(root) {
  try { return fs.statSync(path.join(root, ".git")).isFile(); } catch { return false; }
}

// lead = main thread of the main checkout; everything else (subagents, worker worktrees) is a worker
const isLead = (ev, root) => !ev.agent_id && !isLinked(root);

// <git-common-dir>, absolute. Pure fs for the usual layouts, git only as a fallback.
function gitCommonDir(root) {
  const dotgit = path.join(root, ".git");
  try {
    const st = fs.statSync(dotgit);
    if (st.isDirectory()) return dotgit;
    const m = /^gitdir:\s*(.+?)\s*$/m.exec(fs.readFileSync(dotgit, "utf8"));
    if (m) {
      const gd = path.resolve(root, m[1]);
      let cd = "";
      try { cd = fs.readFileSync(path.join(gd, "commondir"), "utf8").trim(); } catch {}
      return cd ? path.resolve(gd, cd) : gd;
    }
  } catch {}
  try {
    const out = execFileSync("git", ["rev-parse", "--git-common-dir"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 3000, windowsHide: true }).trim();
    return out ? path.resolve(root, out) : null;
  } catch { return null; }
}

// main checkout root: the common dir's parent when it is a .git dir (null for bare repos)
const mainRoot = (common) => (common && path.basename(common) === ".git" ? path.dirname(common) : null);

const hiveDir = (common) => path.join(common, "hive");

function readJSON(file, dflt) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return dflt; }
}

function writeJSON(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + "\n");
  try { fs.renameSync(tmp, file); } catch { fs.writeFileSync(file, JSON.stringify(obj, null, 2) + "\n"); try { fs.unlinkSync(tmp); } catch {} }
}

const configFile = () => path.join(os.homedir(), ".claude", "hivemind.json");
const hivemindConfig = () => readJSON(configFile(), {}) || {};

// repo-relative path with forward slashes; null when outside root (incl. another drive on Windows)
function relPath(root, target) {
  const rel = path.relative(root, path.resolve(root, String(target)));
  if (!rel || rel === ".." || rel.startsWith(".." + path.sep) || path.isAbsolute(rel)) return rel ? null : "";
  return rel.split(path.sep).join("/");
}

// nearest ancestor of dir holding a .git file or dir (a checkout or linked worktree root); null outside git
function gitRoot(dir) {
  let d = path.resolve(String(dir));
  for (;;) {
    if (fs.existsSync(path.join(d, ".git"))) return d;
    const up = path.dirname(d);
    if (up === d) return null;
    d = up;
  }
}

// a hive/* branch exists: loose refs or packed-refs, no git call
function runOpen(common) {
  try { if (fs.readdirSync(path.join(common, "refs", "heads", "hive")).length) return true; } catch {}
  try { return /^\S+ refs\/heads\/hive\//m.test(fs.readFileSync(path.join(common, "packed-refs"), "utf8")); } catch { return false; }
}

// owned-path glob: ** any depth, * within a segment, trailing / means the whole directory
function ownedMatch(glob, rel) {
  const g = glob.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "/**");
  const re = "^" + g.split("**").map((p) => p.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*")).join(".*") + "$";
  return new RegExp(re, process.platform === "win32" ? "i" : "").test(rel);
}

// why an edit of target breaks <wt>/.claude/hive-owned, or "" when allowed or there is no list
function ownedDenial(wt, target) {
  let list;
  try { list = fs.readFileSync(path.join(wt, ".claude", "hive-owned"), "utf8"); } catch { return ""; }
  // path.relative across Windows drives returns an absolute path, not "../"
  const r = path.relative(wt, path.resolve(wt, String(target)));
  const rel = r.split(path.sep).join("/");
  const needs = (why) => `${rel} is ${why}. Comment "NEEDS ${rel}: <why>" on the issue and stop.`;
  if (path.isAbsolute(r) || rel === ".." || rel.startsWith("../")) return needs("outside the worktree");
  const owned = list.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  return owned.some((g) => ownedMatch(g, rel)) ? "" : needs("not in .claude/hive-owned");
}

// last `bytes` of a file as complete lines (first partial line dropped)
function tailLines(file, bytes = 256 * 1024) {
  if (!file) return [];
  let fd;
  try {
    fd = fs.openSync(file, "r");
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - bytes);
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    const lines = buf.toString("utf8").split("\n");
    if (start > 0) lines.shift();
    return lines.filter((l) => l.trim());
  } catch { return []; } finally { if (fd !== undefined) try { fs.closeSync(fd); } catch {} }
}

// newest-first iteration over main-thread transcript entries
function* entriesBackward(lines, sidechain = false) {
  for (let i = lines.length - 1; i >= 0; i--) {
    let e;
    try { e = JSON.parse(lines[i]); } catch { continue; }
    if (!e || typeof e !== "object" || (e.isSidechain === true && !sidechain)) continue;
    yield e;
  }
}

const usageSum = (u) => (u && typeof u === "object"
  ? (+u.input_tokens || 0) + (+u.cache_read_input_tokens || 0) + (+u.cache_creation_input_tokens || 0) : 0);

// context size in tokens: stdin usage if the event carries it, else the newest assistant
// usage in the transcript; 0 after a compaction boundary with no reply since, or on any doubt
function contextTokens(ev) {
  const direct = usageSum(ev.usage);
  if (direct > 0) return direct;
  for (const e of entriesBackward(tailLines(ev.transcript_path))) {
    if (e.subtype === "compact_boundary" || e.isCompactSummary) return 0;
    const m = e.message;
    if (!m || (e.type !== "assistant" && m.role !== "assistant")) continue;
    const n = usageSum(m.usage);
    if (n > 0) return n;
  }
  return 0;
}

// text of the newest assistant message that has any; a subagent's own transcript
// (agent_transcript_path, every entry a sidechain) wins over the session's
function lastAssistantText(ev) {
  if (typeof ev.last_assistant_message === "string") return ev.last_assistant_message;
  const own = ev.agent_transcript_path;
  for (const e of entriesBackward(tailLines(own || ev.transcript_path), !!own)) {
    const m = e.message;
    if (!m || (e.type !== "assistant" && m.role !== "assistant")) continue;
    const c = m.content;
    const text = typeof c === "string" ? c : Array.isArray(c) ? c.filter((b) => b && b.type === "text").map((b) => b.text).join("\n") : "";
    if (text.trim()) return text;
  }
  return "";
}

// newest prompt the human typed, from the transcript tail; null when none is found.
// Newer transcripts tag it origin.kind "human"; older ones are told apart by their prefix.
const NOT_HUMAN = /^\s*(<task-notification|<local-command|<cross-session-message|\[Request interrupted|Another Claude session)/;
function lastHumanPrompt(ev) {
  // image tool results make lines huge, so look further back and parse only candidate lines
  const lines = tailLines(ev.transcript_path, 4 * 1024 * 1024)
    .filter((l) => l.includes("compact_boundary") || (l.includes('"type":"user"') && !l.includes('"toolUseResult"')));
  for (const e of entriesBackward(lines)) {
    if (e.subtype === "compact_boundary") return null;
    if (e.type !== "user" || e.isMeta || e.isCompactSummary || e.toolUseResult !== undefined || !e.message) continue;
    const c = e.message.content;
    const text = typeof c === "string" ? c : Array.isArray(c) ? c.filter((b) => b && b.type === "text").map((b) => b.text).join("\n") : "";
    if (!text.trim()) continue;
    if (e.origin ? e.origin.kind !== "human" : NOT_HUMAN.test(text)) continue;
    return text;
  }
  return null;
}

const execOpts = (cwd, timeout, env) => ({ cwd, encoding: "utf8", timeout, windowsHide: true, stdio: ["ignore", "pipe", "ignore"], env });

// git / gh with a hard timeout; "" on any failure (not installed, no auth, no remote, offline)
function git(args, cwd, timeout = 3000) {
  try { return execFileSync("git", args, execOpts(cwd, timeout)).trim(); } catch { return ""; }
}
function gh(args, cwd, timeout = 6000) {
  try { return execFileSync("gh", args, execOpts(cwd, timeout, { ...process.env, GH_PROMPT_DISABLED: "1", NO_COLOR: "1" })).trim(); } catch { return ""; }
}

const envInt = (name, dflt) => { const n = parseInt(process.env[name], 10); return Number.isFinite(n) && n > 0 ? n : dflt; };

// rules for every non-lead agent: nothing that ends a turn waiting for a wake-up that never comes
const WAIT_MSG = "workers never wait on a background notification (it never arrives after your turn ends). Run it in the foreground with timeout up to 600000 ms, or start it detached (nohup … &) and poll its PID/log in this same turn.";
const EDIT_LAST_MSG = "--edit-last edits the newest comment of the shared GitHub account, which may be another agent's or the lead's ruling. Post a new comment instead.";
function workerDenial(tool, ti) {
  if (tool === "Monitor") return WAIT_MSG;
  if (tool !== "Bash") return null;
  if (ti && ti.run_in_background === true) return WAIT_MSG;
  if (/--edit-last\b/.test(String((ti && ti.command) || ""))) return EDIT_LAST_MSG;
  return null;
}

// PreToolUse refusal: exit 2, stderr reaches the agent as the tool's error
function deny(why) {
  try { fs.writeSync(2, `hivemind: ${why}\n`); } catch {} // sync: process.exit drops async pipe writes
  process.exit(2);
}

function additionalContext(event, text) {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: text } }) + "\n");
}

// The lead's hook set in .claude/settings.local.json. Only adds; never removes a user hook.
const LEAD_GUARD_MATCHER = "Edit|Write|MultiEdit|NotebookEdit|Agent|Task|Bash|Monitor|Read";
const OLD_GUARD_MATCHERS = ["Edit|Write|MultiEdit|NotebookEdit|Agent|Task", "Edit|Write|MultiEdit|NotebookEdit|Agent|Task|Bash|Monitor"];
// [event, script, matcher, timeout s]; the autostart may pull and query gh
const LEAD_HOOKS = [
  ["SessionStart", "hive-autostart.js", undefined, 60],
  ["UserPromptSubmit", "hive-journal.js"],
  ["UserPromptSubmit", "hive-lessons.js"],
  ["PreToolUse", "hive-lead-guard.js", LEAD_GUARD_MATCHER],
  ["PreToolUse", "hive-lessons.js", "Bash|Edit|Write|Read"],
  ["PostToolUse", "hive-lessons.js", "Bash"],
  ["PreToolUse", "hive-scratch.js", "Bash"],
  ["PostToolUse", "hive-scratch.js", "Bash"],
  ["PostToolUseFailure", "hive-scratch.js", "Bash"],
  ["SubagentStop", "hive-stall.js"],
  ["TeammateIdle", "hive-stall.js"],
];

// returns {changed} or {error} (invalid JSON is never overwritten)
function registerLeadHooks(file) {
  let raw = null;
  try { raw = fs.readFileSync(file, "utf8"); } catch {}
  let s = {};
  if (raw !== null && raw.trim()) {
    try { s = JSON.parse(raw); } catch (e) { return { error: `${file} is not valid JSON (${e.message})` }; }
    if (!s || typeof s !== "object" || Array.isArray(s)) return { error: `${file} is not a JSON object` };
  }
  const before = JSON.stringify(s);
  s.hooks = s.hooks && typeof s.hooks === "object" ? s.hooks : {};
  const cmd = (f) => `node "$CLAUDE_PROJECT_DIR/.claude/hooks/${f}"`;
  const names = (entry) => JSON.stringify((entry && entry.hooks) || []);
  for (const [event, script, matcher, timeout] of LEAD_HOOKS) {
    const list = (s.hooks[event] = Array.isArray(s.hooks[event]) ? s.hooks[event] : []);
    const have = list.filter((e) => names(e).includes(script));
    if (have.length) {
      for (const e of have) if (script === "hive-lead-guard.js" && OLD_GUARD_MATCHERS.includes(e.matcher)) e.matcher = matcher;
      continue;
    }
    const entry = { hooks: [{ type: "command", command: cmd(script), ...(timeout && { timeout }) }] };
    if (matcher) entry.matcher = matcher;
    list.push(entry);
  }
  // statusLine commands are not documented to get $CLAUDE_PROJECT_DIR: absolute path, forward
  // slashes (this file is machine-local). Only when the project sets no statusLine of its own.
  if (!("statusLine" in s)) {
    const script = path.resolve(path.dirname(file), "hooks", "hive-statusline.js").split(path.sep).join("/");
    s.statusLine = { type: "command", command: `node "${script}"` };
  }
  if (JSON.stringify(s) === before) return { changed: false };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(s, null, 2) + "\n");
  return { changed: true };
}

// copy src → dst only when the bytes differ; true when written
function syncFile(src, dst) {
  let a;
  try { a = fs.readFileSync(src); } catch { return false; }
  try { if (a.equals(fs.readFileSync(dst))) return false; } catch {}
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.writeFileSync(dst, a);
  return true;
}

// The human's inbox: open needs-human issues, cached in <common>/hive/inbox.json as
// {at, questions:[{n,title}], reviews:[{n,title}]}. null when there is no cache.
const inboxFile = (common) => path.join(hiveDir(common), "inbox.json");
function readInbox(common) {
  const c = readJSON(inboxFile(common), null);
  return c && Array.isArray(c.questions) && Array.isArray(c.reviews) ? c : null;
}
// gh query → cache; on any gh failure the old cache stays and null is returned
function refreshInbox(root, common, timeout = 10000) {
  let list;
  try { list = JSON.parse(gh(["issue", "list", "--label", "needs-human", "--state", "open", "--json", "number,title,labels", "--limit", "100"], root, timeout)); } catch { return null; }
  if (!Array.isArray(list)) return null;
  const has = (i, name) => (i.labels || []).some((l) => l && l.name === name);
  const item = (i) => ({ n: i.number, title: String(i.title || "") });
  const inbox = { at: new Date().toISOString(), questions: list.filter((i) => has(i, "hive-question")).map(item), reviews: list.filter((i) => has(i, "hive-review")).map(item) };
  writeJSON(inboxFile(common), inbox);
  return inbox;
}

module.exports = {
  readInbox, refreshInbox, inboxFile,
  run, projectRoot, isLinked, isLead, gitCommonDir, mainRoot, hiveDir, readJSON, writeJSON,
  configFile, hivemindConfig, relPath, gitRoot, runOpen, ownedMatch, ownedDenial, tailLines, contextTokens, lastAssistantText, lastHumanPrompt, envInt, git, gh,
  workerDenial, deny, additionalContext, registerLeadHooks, syncFile, LEAD_HOOKS, WAIT_MSG, EDIT_LAST_MSG,
};
