// Shared core of the hive-*.js hooks: git, ownership, the ladder, the inbox. Plain Node, no
// dependencies, no shell, nothing specific to one coding-agent CLI (that is hive-harness.js).
// Every hook fails open: an internal error exits 0 and never blocks the session.
"use strict";
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFileSync } = require("child_process");

// the harness adapter. The adapter requires this file too: it is loaded at the end, once this
// file's exports are complete, and taken again on use if a load that began at the adapter left it partial.
const HARNESS = path.join(__dirname, "hive-harness.js");
let adapter = null;
const harness = () => (adapter && adapter.event ? adapter : (adapter = require(HARNESS)));

// read the hook's stdin JSON, run main(hive event, adapter); any throw or rejection exits 0
function run(main) {
  process.on("uncaughtException", () => process.exit(0));
  process.on("unhandledRejection", () => process.exit(0));
  let input = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (c) => (input += c));
  process.stdin.on("end", async () => {
    let raw = {};
    try { raw = JSON.parse(input) || {}; } catch {}
    try { const ad = harness(); await main(ad.event(raw), ad); } catch (e) { if (process.env.HIVE_DEBUG) process.stderr.write(`hive hook: ${e.stack}\n`); }
    // pipes are async on macOS: exit only once stdout has drained
    process.stdout.write("", () => process.exit(0));
  });
}

// the project dir: the event's, else the one the harness reports outside a hook
const projectRoot = (ev) => (ev && ev.root) || harness().projectRoot({});

// linked worktree: .git is a file pointing at the main checkout
function isLinked(root) {
  try { return fs.statSync(path.join(root, ".git")).isFile(); } catch { return false; }
}

// lead = main thread of the main checkout; everything else (subagents, worker worktrees) is a worker
const isLead = (ev, root) => !ev.agent && !isLinked(root);

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

// a worktree the lead dispatched a worker into: it lists the ticket's owned paths
const ownedFile = (wt) => harness().ownedFile(wt);

// why an edit of target breaks the worktree's owned-path list, or "" when allowed or there is no list
function ownedDenial(wt, target) {
  let list;
  try { list = fs.readFileSync(ownedFile(wt), "utf8"); } catch { return ""; }
  // path.relative across Windows drives returns an absolute path, not "../"
  const r = path.relative(wt, path.resolve(wt, String(target)));
  const rel = r.split(path.sep).join("/");
  const needs = (why) => `${rel} is ${why}. Comment "NEEDS ${rel}: <why>" on the issue and stop.`;
  if (path.isAbsolute(r) || rel === ".." || rel.startsWith("../")) return needs("outside the worktree");
  const owned = list.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  return owned.some((g) => ownedMatch(g, rel)) ? "" : needs(`not in ${path.relative(wt, ownedFile(wt)).split(path.sep).join("/")}`);
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
function workerDenial(ev) {
  if (ev.tool === "monitor") return WAIT_MSG;
  if (ev.tool !== "shell") return null;
  if (ev.background) return WAIT_MSG;
  if (/--edit-last\b/.test(ev.command)) return EDIT_LAST_MSG;
  return null;
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
// ---- model ladder: the lead is whatever model the session runs; no agent goes above it.
// Rungs cheapest first. ~/.claude/hivemind.json "models": { ladder, floor, solo } overrides the
// defaults; a project's `models:` line in AGENTS.md (the human's call, e.g. `models: solo=none
// floor=haiku`) overrides floor and solo. A solo model never runs as a subagent: at most one per
// project, and that one is the lead when the session runs on it.
const MODEL_DEFAULTS = { ladder: ["haiku", "sonnet", "opus", "fable"], floor: "sonnet", solo: ["fable"] };

// ladder index of a model name or id ("claude-opus-5-5[1m]" → opus); the longest matching rung wins
function rungOf(ladder, name) {
  const n = String(name || "").toLowerCase();
  let best = -1;
  ladder.forEach((r, i) => { if (n.includes(r) && (best < 0 || r.length > ladder[best].length)) best = i; });
  return best;
}

// the session's model, as the harness finds it
const leadModel = (ev) => harness().sessionModel(ev);
// the model SessionStart reported, kept by the autostart for when the transcript tail has no reply
const leadFile = (root) => { const c = gitCommonDir(root); return c ? path.join(hiveDir(c), "lead-model.json") : null; };
function saveLead(ev, root) {
  const f = leadFile(root);
  if (f && ev.model && ev.session) writeJSON(f, { session: ev.session, model: ev.model });
}
function savedLead(ev, root) {
  const f = leadFile(root);
  const saved = f ? readJSON(f, null) : null;
  return saved && saved.session === ev.session && typeof saved.model === "string" ? saved.model : "";
}

function modelPolicy(root) {
  const cfg = (hivemindConfig().models || {});
  const list = (v) => (Array.isArray(v) ? v : String(v || "").split(",")).map((x) => String(x).trim().toLowerCase()).filter((x) => x && x !== "none");
  const ladder = Array.isArray(cfg.ladder) && cfg.ladder.length ? list(cfg.ladder) : MODEL_DEFAULTS.ladder;
  const pol = { ladder, floor: String(cfg.floor || MODEL_DEFAULTS.floor).toLowerCase(), solo: "solo" in cfg ? list(cfg.solo) : MODEL_DEFAULTS.solo };
  let agents = "";
  try { agents = fs.readFileSync(path.join(root, "AGENTS.md"), "utf8"); } catch {}
  const line = /^models:(.*)$/m.exec(agents);
  if (line) {
    for (const [, k, v] of line[1].matchAll(/(\w+)=(\S+)/g)) {
      if (k === "floor") pol.floor = v.toLowerCase();
      if (k === "solo") pol.solo = list(v);
    }
  }
  return pol;
}

// what this session may spawn: top (hard tickets, every verdict) and mid (standard tickets, helpers)
function modelCaps(ev, root) {
  const pol = modelPolicy(root);
  const { ladder, solo } = pol;
  const lead = leadModel(ev) || savedLead(ev, root);
  const L = rungOf(ladder, lead);
  // highest rung at or under the lead that is not solo (the lead is that one instance); unknown lead: the whole ladder
  let cap = L < 0 ? ladder.length - 1 : L;
  while (cap > 0 && solo.includes(ladder[cap])) cap--;
  const fl = rungOf(ladder, pol.floor);
  const floor = Math.min(fl < 0 ? 0 : fl, cap); // a lead below the floor takes the floor down with it
  return { ladder, solo, lead, leadRung: L, cap, floor, top: ladder[cap], mid: ladder[Math.max(floor, cap - 1)], floorName: ladder[floor] };
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
  configFile, hivemindConfig, relPath, gitRoot, runOpen, ownedFile, ownedMatch, ownedDenial, tailLines, envInt, git, gh,
  workerDenial, rungOf, leadModel, saveLead, modelPolicy, modelCaps, syncFile, WAIT_MSG, EDIT_LAST_MSG,
};
try { harness(); } catch {}
