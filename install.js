#!/usr/bin/env node
// Install, update or check the hivemind skill for Claude Code, on any OS (Node 22.5+, which context-mode needs).
// install.sh and install.ps1 are thin wrappers around this file.
//
//   node install.js                   link skills/{hivemind,hivemind-review} into ~/.claude/skills
//                                     (every repo; `git pull` here updates them), copy agents/*.md
//                                     to ~/.claude/agents, record this checkout in ~/.claude/hivemind.json,
//                                     install the required context-mode plugin through the claude CLI
//   node install.js --project         also set up the current repo: teams/<profile>/ with skills
//                                     linked per skills.txt, the lead's hooks in
//                                     .claude/settings.local.json (HIVEMIND=0 claude skips them);
//                                     removes project copies of the skill and unmodified agents
//   node install.js --project --install   also `npx skills add` any skill not on this machine
//   node install.js --project --confine   also remove the global ~/.claude/skills/<name> link
//                                         for every linked skill, so the lead never sees it
//   node install.js --update          git pull --ff-only this checkout, reinstall, and refresh the
//                                     current repo too if it is a hivemind project
//   node install.js --auto-update     let the SessionStart hook pull this checkout (off by default);
//   node install.js --no-auto-update  both run the global install and persist the choice
//   node install.js --laya <url|off>  point lesson recall at a local laya classifier, or decline it
//   node install.js --laya setup      print the laya install steps for this machine (GPU only; runs nothing)
//   node install.js --doctor [--fix]  check the setup; --fix applies the safe local fixes
"use strict";
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const L = require("./teams/link-skills.js");
const { WIN, lstat, real, isDir, isFile, samePath, removeLink, linkDir } = L;

const HERE = __dirname;
const HOME = os.homedir();
const CLAUDE = path.join(HOME, ".claude");
const SKILLS = ["hivemind", "hivemind-review"];
const LINK_SCRIPTS = ["link-skills.js", "link-skills.sh", "link-skills.ps1"];
const EXCLUDE = [".claude/settings.local.json", ".claude/hooks/hive-*.js", ".claude/hooks/worktree-settings.local.json", ".claude/hive-owned"];
const TEAMS_ENV = "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS";
const CTX_PLUGIN = "context-mode@context-mode";
const CTX_MARKET = "mksglu/context-mode";
const NODE_MIN = "22.5.0";
// sha256 (LF line endings) of templates/hooks/settings.local.json as shipped before its rename
const OLD_WORKER_SETTINGS = "365bfd02b83f795a76f0656aeb238f7295c0194dad2babce80ef37bba5692542";

let quiet = false;
const log = (s = "") => { if (!quiet) console.log(s); };
const warn = (s) => console.error(s);
const die = (s, code = 1) => { warn(s); process.exit(code); };

// helpers

function git(args, cwd) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", stdio: ["inherit", "pipe", "pipe"] });
  return { ok: r.status === 0, out: (r.stdout || "").trim(), err: (r.stderr || "").trim() };
}
function has(cmd, args = ["--version"]) {
  const r = spawnSync(cmd, args, { encoding: "utf8", shell: WIN, timeout: 20000 });
  return r.status === 0 ? (r.stdout || "").trim() : null;
}
const norm = (s) => s.replace(/\r\n/g, "\n");
const readText = (p) => { try { return fs.readFileSync(p, "utf8"); } catch { return null; } };
const inside = (child, parent) => { const r = path.relative(parent, child); return r === "" || (!r.startsWith("..") && !path.isAbsolute(r)); };

// {} when missing or empty, null when not a JSON object
function readJson(file) {
  const t = readText(file);
  if (t === null || !t.trim()) return {};
  try {
    const v = JSON.parse(t.replace(/^﻿/, ""));
    return v && typeof v === "object" && !Array.isArray(v) ? v : null;
  } catch { return null; }
}
function writeJson(file, v) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(v, null, 2) + "\n");
}

function frontmatterName(dir) {
  const t = readText(path.join(dir, "SKILL.md"));
  const fm = t && /^---\r?\n([\s\S]*?)\r?\n---/.exec(t);
  const m = fm && /^name:\s*["']?([^"'\r\n]+?)["']?\s*$/m.exec(fm[1]);
  return m ? m[1] : null;
}

// copy unless identical; a link at dest is replaced, never written through
function copyFile(src, dest) {
  const st = lstat(dest);
  if (st && !st.isSymbolicLink() && fs.readFileSync(src).equals(fs.readFileSync(dest))) return;
  if (st && st.isSymbolicLink()) removeLink(dest);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}
function copyTree(src, dest) {
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dest, e.name);
    if (e.isDirectory()) copyTree(s, d); else copyFile(s, d);
  }
}

const shippedAgents = () => fs.readdirSync(path.join(HERE, "agents")).filter((f) => f.endsWith(".md")).sort();
const isHiveProject = (dir) => isDir(path.join(dir, "teams")) && isFile(path.join(dir, ".claude", "hooks", "hive-autostart.js"));

function envCommand() {
  if (WIN) return `[Environment]::SetEnvironmentVariable("${TEAMS_ENV}", "1", "User")`;
  const sh = path.basename(process.env.SHELL || "");
  if (sh === "fish") return `set -Ux ${TEAMS_ENV} 1`;
  return `echo 'export ${TEAMS_ENV}=1' >> ~/.${sh === "zsh" ? "zshrc" : "bashrc"}`;
}
function teamsEnvOn() {
  const s = readJson(path.join(CLAUDE, "settings.json"));
  return process.env[TEAMS_ENV] === "1" || String(s && s.env && s.env[TEAMS_ENV]) === "1";
}

// global install

function linkSkills() {
  let ok = true;
  const dir = path.join(CLAUDE, "skills");
  fs.mkdirSync(dir, { recursive: true });
  for (const s of SKILLS) {
    const target = real(path.join(HERE, "skills", s));
    const link = path.join(dir, s);
    const st = lstat(link);
    if (st && !st.isSymbolicLink()) {
      // an old installer's copy is replaced; anything else is someone else's
      if (!st.isDirectory() || frontmatterName(link) !== s || inside(HERE, link)) {
        warn(`error: ${link} is not an old copy of the ${s} skill; move it away and re-run`);
        ok = false;
        continue;
      }
      fs.rmSync(link, { recursive: true, force: true });
      log(`removed  ${link} (old copy, replaced by a link)`);
    }
    linkDir(target, link);
  }
  if (ok) log(`skills   -> ${path.join(dir, "{hivemind,hivemind-review}")} linked to ${path.join(real(HERE), "skills")}`);
  return ok;
}

function copyAgents() {
  const dir = path.join(CLAUDE, "agents");
  const files = shippedAgents();
  for (const f of files) copyFile(path.join(HERE, "agents", f), path.join(dir, f));
  // only what ships is overwritten; other agents there survive
  log(`agents   -> ${dir} (${files.length} shipped, others untouched)`);
}

function setAttribution() {
  const file = path.join(CLAUDE, "settings.json");
  const s = readJson(file);
  if (!s) {
    warn(`warning: ${file} is not valid JSON; left alone. Add by hand:`);
    warn('  "attribution": { "commit": "", "pr": "", "sessionUrl": false }');
    return false;
  }
  const want = { ...(s.attribution || {}), commit: "", pr: "", sessionUrl: false };
  if (JSON.stringify(s.attribution) !== JSON.stringify(want)) { s.attribution = want; writeJson(file, s); }
  log("settings -> attribution disabled");
  return true;
}

// ~/.claude/hivemind.json: { home, autoUpdate, laya?, layaOffered?, ...keys the hooks own }
const CONFIG = path.join(CLAUDE, "hivemind.json");
function readConfig() {
  const c = readJson(CONFIG);
  if (!c) warn(`warning: ${CONFIG} was not valid JSON; rewritten`);
  return c || {};
}
function patchConfig(patch) {
  const c = readConfig();
  const next = { ...c, ...patch };
  if (JSON.stringify(next) !== JSON.stringify(c)) writeJson(CONFIG, next);
  return next;
}

function writeConfig({ autoUpdate, laya } = {}) {
  const c = readConfig();
  const patch = { home: real(HERE), autoUpdate: autoUpdate ?? (typeof c.autoUpdate === "boolean" ? c.autoUpdate : false) };
  if (laya !== undefined) patch.laya = laya;
  const next = patchConfig(patch);
  const l = next.laya === "off" ? ", laya off" : next.laya && next.laya.url ? `, laya ${next.laya.url}` : "";
  log(`config   -> ${CONFIG} (autoUpdate ${next.autoUpdate}${l})`);
}

function globalInstall(config) {
  const ok = linkSkills();
  copyAgents();
  writeConfig(config);
  installContextMode(); // required, but a missing claude CLI is not fatal: --doctor keeps failing until it is there
  return setAttribution() && ok;
}

const nodeOk = (v = process.versions.node) => {
  const [a, b] = v.split(".").map(Number), [ma, mb] = NODE_MIN.split(".").map(Number);
  return a > ma || (a === ma && b >= mb);
};
const nodeFix = () => (WIN ? "winget install OpenJS.NodeJS.LTS" : "brew install node | sudo pacman -S nodejs npm | nvm install --lts | https://nodejs.org");

// context-mode: installed per ~/.claude/plugins/installed_plugins.json, enabled per settings.json; read only
function contextMode() {
  const inst = readJson(path.join(CLAUDE, "plugins", "installed_plugins.json")) || {};
  const known = readJson(path.join(CLAUDE, "plugins", "known_marketplaces.json")) || {};
  const s = readJson(path.join(CLAUDE, "settings.json")) || {};
  const installed = !!(inst.plugins && Array.isArray(inst.plugins[CTX_PLUGIN]) && inst.plugins[CTX_PLUGIN].length);
  const enabled = !!(s.enabledPlugins && s.enabledPlugins[CTX_PLUGIN] === true);
  return { installed, enabled, known: !!known[CTX_PLUGIN.split("@")[1]] };
}
function contextModeSteps(c = contextMode()) {
  return [
    ...(c.installed || c.known ? [] : [["plugin", "marketplace", "add", CTX_MARKET]]),
    c.installed ? ["plugin", "enable", CTX_PLUGIN, "--scope", "user"] : ["plugin", "install", CTX_PLUGIN, "--scope", "user"],
  ];
}
// through the claude CLI, never by editing settings.json; false (with the commands printed) when it did not take
function installContextMode() {
  const c = contextMode();
  if (c.installed && c.enabled) { log(`plugin   -> ${CTX_PLUGIN} enabled`); return true; }
  const steps = contextModeSteps(c);
  for (const args of steps) {
    const r = spawnSync("claude", args, { stdio: quiet ? "pipe" : "inherit", shell: WIN, timeout: 300000 });
    if (r.status !== 0) break;
  }
  const after = contextMode();
  if (after.installed && after.enabled) { log(`plugin   -> ${CTX_PLUGIN} installed`); return true; }
  warn(`warning: the required context-mode plugin is not ${after.installed ? "enabled" : "installed"}. Run:`);
  for (const args of steps) warn(`  claude ${args.join(" ")}`);
  return false;
}

// laya is offered only with a GPU: NVIDIA with >= 6 GB VRAM, or Apple Silicon. Any doubt is no GPU.
function gpu() {
  if (process.platform === "darwin" && process.arch === "arm64") return "Apple Silicon";
  const r = spawnSync("nvidia-smi", ["--query-gpu=name,memory.total", "--format=csv,noheader"], { encoding: "utf8", shell: WIN, timeout: 5000 });
  if (r.status !== 0 || typeof r.stdout !== "string") return null;
  for (const line of r.stdout.split(/\r?\n/)) {
    const m = /^(.+?),\s*(\d+)\s*MiB\s*$/.exec(line.trim());
    if (m && Number(m[2]) >= 6 * 1024) return `${m[1]} ${(Number(m[2]) / 1024).toFixed(1)} GB`;
  }
  return null;
}

// printed, never run: the human runs them (a ~3 GB download on NVIDIA)
function layaSetup() {
  const g = gpu();
  const venv = "~/.local/share/laya/venv";
  const on = `node "${path.join(HERE, "install.js")}" --laya http://127.0.0.1:47311`;
  if (WIN) {
    log(`laya on Windows: follow https://github.com/NandhaKishorM/laya#readme with LAYA_HOST=127.0.0.1 LAYA_PORT=47311${g ? "" : " (no NVIDIA GPU with 6 GB+ found: not recommended)"}, then:`);
    log(`  ${on}`);
    return true;
  }
  if (g === "Apple Silicon") {
    log("laya on Apple Silicon (untested; the numbers in the README are from an NVIDIA card):");
    for (const c of [`python3 -m venv ${venv}`, `${venv}/bin/pip install --only-binary=:all: torch==2.14.0 "laya[serve]==0.3.21"`,
      `env LAYA_HOST=127.0.0.1 LAYA_PORT=47311 LAYA_DEVICE=mps LAYA_MODELS=multilingual LAYA_PRELOAD=1 LAYA_MAX_LOADED=1 LAYA_MAX_TOKEN_BUDGET=1024 ${venv}/bin/laya-serve`, on]) log(`  ${c}`);
    return true;
  }
  if (!g || process.platform !== "linux") {
    warn(`laya setup covers Linux with an NVIDIA GPU (6 GB+ VRAM) and Apple Silicon; ${g ? process.platform : "no such GPU found"}. On a CPU it is heavy and not recommended (README "Optional: laya").`);
    return false;
  }
  const unit = path.join(HERE, "templates", "laya", "laya.service");
  log(`laya on ${g}: run these yourself (~3 GB download, ~5.5 GB on disk; hivemind never runs them):`);
  for (const c of [`python3 -m venv ${venv}`,
    `${venv}/bin/pip install --only-binary=:all: --index-url https://download.pytorch.org/whl/cu132 torch==2.14.0+cu132`,
    `${venv}/bin/pip install --only-binary=:all: "laya[serve]==0.3.21"`,
    "mkdir -p ~/.config/systemd/user", `cp "${unit}" ~/.config/systemd/user/laya.service`,
    "systemctl --user enable --now laya", on]) log(`  ${c}`);
  log("");
  log(`The unit (${unit}):`);
  log(fs.readFileSync(unit, "utf8").trimEnd().split("\n").map((l) => `  ${l}`).join("\n"));
  return true;
}

// "off", or { url, threshold } for an http(s) URL; null when invalid
function parseLaya(v) {
  if (v === "off") return "off";
  try {
    const u = new URL(v);
    if (u.protocol === "http:" || u.protocol === "https:") return { url: v.replace(/\/+$/, ""), threshold: 0.8 };
  } catch {}
  return null;
}

// project

// Copies of the skill, and unmodified copies of shipped agents, in <dir>/.claude.
// Returns { dupes: [path], overrides: [path] }; act removes the dupes.
function projectDupes(dir, act) {
  const dupes = [], overrides = [];
  if (samePath(real(dir), real(HOME))) return { dupes, overrides }; // ~/.claude is the global install
  for (const s of SKILLS) {
    const p = path.join(dir, ".claude", "skills", s);
    const st = lstat(p);
    if (!st) continue;
    if (st.isSymbolicLink()) { dupes.push(p); if (act) removeLink(p); }
    else if (st.isDirectory() && frontmatterName(p) === s && !inside(HERE, p)) { dupes.push(p); if (act) fs.rmSync(p, { recursive: true, force: true }); }
  }
  for (const f of shippedAgents()) {
    const p = path.join(dir, ".claude", "agents", f);
    const t = readText(p);
    if (t === null) continue;
    if (norm(t) === norm(fs.readFileSync(path.join(HERE, "agents", f), "utf8"))) {
      dupes.push(p);
      if (act) { if (lstat(p).isSymbolicLink()) removeLink(p); else fs.unlinkSync(p); }
    } else overrides.push(p);
  }
  return { dupes, overrides };
}

function registerHooks(root) {
  const script = path.join(HERE, "templates", "hooks", "install-lead-hooks.js");
  const r = spawnSync(process.execPath, [script], { cwd: root, stdio: quiet ? "pipe" : "inherit", encoding: "utf8" });
  if (r.status === 0) return true;
  warn(`error: ${script} exited ${r.status ?? r.error}; lead hooks may be missing`);
  if (quiet && r.stderr) warn(r.stderr.trim());
  return false;
}

function excludeLocal(root) {
  const r = git(["rev-parse", "--git-common-dir"], root);
  if (!r.ok) { log("exclude  -> skipped (not a git repo)"); return; }
  const file = path.join(path.resolve(root, r.out), "info", "exclude");
  let text = readText(file) || "";
  const have = text.split(/\r?\n/);
  const add = EXCLUDE.filter((l) => !have.includes(l));
  if (add.length) {
    if (text && !text.endsWith("\n")) text += "\n";
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text + add.join("\n") + "\n");
  }
  log(`exclude  -> ${path.relative(root, file) || file} (settings.local.json, hive hooks, hive-owned)`);
}

function copyTeams(root) {
  const teams = path.join(root, "teams");
  fs.mkdirSync(teams, { recursive: true });
  if (!lstat(path.join(teams, ".gitignore"))) fs.copyFileSync(path.join(HERE, "teams", ".gitignore"), path.join(teams, ".gitignore"));
  for (const f of LINK_SCRIPTS) copyFile(path.join(HERE, "teams", f), path.join(teams, f));
  copyTree(path.join(HERE, "templates"), path.join(teams, "templates"));
  // renamed to worktree-settings.local.json; drop the old copy only if nobody edited it
  const stale = path.join(teams, "templates", "hooks", "settings.local.json");
  const t = readText(stale);
  if (t !== null && !isFile(path.join(HERE, "templates", "hooks", "settings.local.json"))
      && crypto.createHash("sha256").update(norm(t)).digest("hex") === OLD_WORKER_SETTINGS) {
    fs.unlinkSync(stale);
    log("removed  teams/templates/hooks/settings.local.json (renamed to worktree-settings.local.json)");
  }
  // the routing table is the repo's once copied, like PROFILE.md
  if (!lstat(path.join(teams, "ROUTING.md"))) fs.copyFileSync(path.join(HERE, "teams", "ROUTING.md"), path.join(teams, "ROUTING.md"));
  for (const p of L.profiles(path.join(HERE, "teams"))) {
    const src = path.join(HERE, "teams", p), dest = path.join(teams, p);
    fs.mkdirSync(dest, { recursive: true });
    for (const f of ["PROFILE.md", "skills.txt"]) {
      if (isFile(path.join(src, f)) && !lstat(path.join(dest, f))) fs.copyFileSync(path.join(src, f), path.join(dest, f));
    }
    // required.txt is the pipeline's, not the scout's or the repo's: always refreshed
    if (isFile(path.join(src, "required.txt"))) copyFile(path.join(src, "required.txt"), path.join(dest, "required.txt"));
  }
  log(`teams    -> ${teams} (ROUTING.md, PROFILE.md, skills.txt, link-skills.*, templates/)`);
}

function projectInstall(root, opt) {
  const { dupes, overrides } = projectDupes(root, true);
  for (const p of dupes) log(`removed  ${path.relative(root, p)} (duplicate of the global install)`);
  for (const p of overrides) log(`local override kept: ${path.relative(root, p).split(path.sep).join("/")} (differs from shipped; delete it to use the shipped one)`);
  copyTeams(root);
  L.run({ root, install: !!opt.install, confine: !!opt.confine, log });
  // lead autostart + guard: machine-local, never tracked, so worker worktrees do not inherit them
  const ok = registerHooks(root);
  excludeLocal(root);
  return ok;
}

function install(opt) {
  if (!nodeOk()) die(`node ${process.versions.node} is older than ${NODE_MIN}, which the required context-mode plugin needs. Upgrade: ${nodeFix()}, then re-run`);
  const autoUpdate = opt.autoUpdate ? true : opt.noAutoUpdate ? false : undefined;
  const laya = opt.laya === undefined ? undefined : parseLaya(opt.laya);
  if (laya === null) die(`--laya takes an http(s) URL or "off", not: ${opt.laya}`, 2);
  const root = process.cwd();
  if (opt.project && samePath(real(root), real(HERE))) die("--project sets up your repo; run it from there, not from the hivemind checkout");
  if (opt.project && samePath(real(root), real(HOME))) die("--project sets up a repo; run it from the repo root, not from your home directory");
  let ok = globalInstall({ autoUpdate, laya });
  if (opt.project) ok = projectInstall(root, opt) && ok;
  if (!teamsEnvOn()) {
    log("");
    log("Enable agent teams once, then restart the terminal:");
    log(`  ${envCommand()}`);
  }
  log("");
  log(ok ? "Done. /hivemind bootstraps the rest." : "Done, with errors above.");
  const c = readConfig();
  // offered once, and only with a GPU; without one it is marked offered silently
  if (c.laya === undefined && c.layaOffered !== true) {
    const self = `node "${path.join(HERE, "install.js")}"`;
    const g = gpu();
    if (g) {
      log("");
      log(`optional: laya (local classifier on your ${g}, ~1.5 GB VRAM; README "Optional: laya") can improve lesson recall. Steps: ${self} --laya setup · decline: ${self} --laya off. This is shown once.`);
    }
    patchConfig({ layaOffered: true });
  }
  return ok;
}

// update

function update(argv) {
  const home = real(HERE);
  const top = git(["rev-parse", "--show-toplevel"], home);
  if (!top.ok || !samePath(real(top.out), home)) die(`${home} is not a git checkout; re-clone hivemind to update it`);
  if (git(["status", "--porcelain", "--untracked-files=no"], home).out) {
    die(`${home} has local changes; commit or stash them, then re-run (git -C "${home}" status)`);
  }
  const before = git(["rev-parse", "HEAD"], home).out;
  const pull = git(["pull", "--ff-only"], home);
  if (!pull.ok) die(`git pull --ff-only failed in ${home}:\n${pull.err}\nresolve it by hand (git -C "${home}" status), then re-run`);
  const after = git(["rev-parse", "HEAD"], home).out;
  log(`update   -> ${home} ${before === after ? "already up to date" : `${before.slice(0, 7)}..${after.slice(0, 7)}`}`);
  // the pull may have changed this file: the new code does the install
  const rest = argv.filter((a) => a !== "--update");
  if (!rest.includes("--project") && isHiveProject(process.cwd()) && !samePath(real(process.cwd()), home)) rest.push("--project");
  const r = spawnSync(process.execPath, [path.join(HERE, "install.js"), ...rest], { stdio: "inherit" });
  process.exit(r.status ?? 1);
}

// doctor

async function doctor(fix) {
  const root = process.cwd();
  const top = git(["rev-parse", "--show-toplevel"], root);
  const inRepo = top.ok && !samePath(real(top.out), real(HERE));
  const hive = inRepo && isDir(path.join(root, "teams"));
  const self = `node "${path.join(HERE, "install.js")}"`;
  const checks = [];
  // test() returns [status, what, fix command]
  const check = (test, fixFn) => checks.push({ test, fixFn });

  check(() => {
    const v = process.versions.node;
    return nodeOk(v) ? ["ok", `node ${v}`] : ["FIX", `node ${v} is older than ${NODE_MIN} (context-mode needs it)`, nodeFix()];
  });
  check(() => has("git") ? ["ok", "git"]
    : ["FIX", "git not found", WIN ? "winget install Git.Git" : "brew install git | sudo pacman -S git | sudo apt install git"]);
  let ghAuthed = false;
  check(() => {
    if (!has("gh")) return ["FIX", "gh not found", WIN ? "winget install GitHub.cli" : "brew install gh | sudo pacman -S github-cli | https://cli.github.com"];
    ghAuthed = has("gh", ["auth", "status"]) !== null;
    return ghAuthed ? ["ok", "gh logged in"] : ["FIX", "gh not logged in", "gh auth login"];
  });
  if (WIN) {
    check(() => has("where", ["bash"]) ? ["ok", "Git Bash"]
      : ["FIX", "bash not found (Claude Code on Windows needs Git Bash)", "winget install Git.Git"]);
  }
  check(() => teamsEnvOn() ? ["ok", `${TEAMS_ENV}=1`]
    : ["FIX", `${TEAMS_ENV} not set`, `${envCommand()}, then restart the terminal`]);
  check(() => {
    const cache = path.join(CLAUDE, "plugins", "cache");
    const found = (isDir(cache) ? fs.readdirSync(cache) : []).some((m) => {
      const d = path.join(cache, m, "mattpocock-skills");
      return isDir(d) && fs.readdirSync(d).some((v) => isDir(path.join(d, v, "skills")));
    });
    return found ? ["ok", "mattpocock-skills plugin"]
      : ["FIX", "mattpocock-skills plugin missing", "inside Claude Code: /plugin install mattpocock-skills@claude-plugins-official"];
  });
  check(() => {
    const c = contextMode();
    return c.installed && c.enabled ? ["ok", `${CTX_PLUGIN} plugin`]
      : ["FIX", `${CTX_PLUGIN} plugin (required) ${c.installed ? "disabled" : "missing"}`, contextModeSteps(c).map((a) => `claude ${a.join(" ")}`).join(" && ")];
  }, () => installContextMode());
  check(() => {
    const bad = SKILLS.filter((s) => {
      const link = path.join(CLAUDE, "skills", s);
      return !(lstat(link) && lstat(link).isSymbolicLink() && samePath(real(link), real(path.join(HERE, "skills", s))));
    });
    return bad.length ? ["FIX", `~/.claude/skills/{${bad.join(",")}} not linked to this checkout`, self]
      : ["ok", `global skills link to ${path.join(real(HERE), "skills")}`];
  }, () => linkSkills());
  check(() => {
    const stale = shippedAgents().filter((f) => {
      const t = readText(path.join(CLAUDE, "agents", f));
      return t === null || norm(t) !== norm(fs.readFileSync(path.join(HERE, "agents", f), "utf8"));
    });
    return stale.length ? ["FIX", `~/.claude/agents: ${stale.length} shipped agents missing or stale`, self] : ["ok", "global agents current"];
  }, () => copyAgents());
  check(() => {
    const c = readJson(path.join(CLAUDE, "hivemind.json"));
    return c && samePath(c.home, real(HERE)) ? ["ok", `hivemind.json home, autoUpdate ${c.autoUpdate === true}`]
      : ["FIX", "~/.claude/hivemind.json missing or points elsewhere", self];
  }, () => writeConfig());
  // laya is optional: reported only once enabled, and never counted as something to fix
  const laya = (readJson(CONFIG) || {}).laya;
  if (laya && laya.url) {
    check(async () => {
      try {
        await fetch(laya.url + "/", { signal: AbortSignal.timeout(500) });
        return ["ok", `laya answers at ${laya.url}`];
      } catch {
        return ["WARN", `laya not answering at ${laya.url}`, `start it, or ${self} --laya off`];
      }
    });
    check(() => gpu() ? ["ok", "laya has a GPU"] : ["WARN", "laya on CPU: heavy (no NVIDIA GPU with 6 GB+ or Apple Silicon found)", `${self} --laya off`]);
  }
  check(() => {
    const s = readJson(path.join(CLAUDE, "settings.json"));
    const a = s && s.attribution;
    if (!s) return ["FIX", "~/.claude/settings.json is not valid JSON", "fix it by hand, then re-run"];
    return a && a.commit === "" && a.pr === "" ? ["ok", "attribution off"] : ["FIX", "attribution not disabled", self];
  }, () => setAttribution());

  // skill copies in this dir or a parent (below $HOME) show /hivemind twice
  const dirs = [];
  for (let d = root; ; d = path.dirname(d)) {
    if (samePath(real(d), real(HOME))) break;
    dirs.push(d);
    if (path.dirname(d) === d) break;
  }
  check(() => {
    const dupes = dirs.flatMap((d) => projectDupes(d, false).dupes);
    return dupes.length ? ["FIX", `duplicate copies: ${dupes.join(", ")}`, `${self} --doctor --fix`] : ["ok", "no duplicate skill or agent copies"];
  }, () => dirs.forEach((d) => projectDupes(d, true)));
  check(() => {
    const kept = dirs.flatMap((d) => projectDupes(d, false).overrides);
    return kept.length ? ["WARN", `local agent overrides: ${kept.join(", ")}`, "delete them to use the shipped ones"] : ["ok", "no local agent overrides"];
  });

  if (!inRepo) {
    const where = top.ok ? "in the hivemind checkout" : "not inside a git repo";
    check(() => ["WARN", `${where}; project checks skipped`, "cd into your repo and re-run"]);
  } else {
    check(() => {
      const remotes = git(["remote", "-v"], root).out;
      if (!/github\.com/.test(remotes)) return ["FIX", "no GitHub remote", "gh repo create --private --source . --push"];
      if (!ghAuthed) return ["WARN", "GitHub remote not verified (gh not ready)", "gh auth login"];
      const r = spawnSync("gh", ["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"], { cwd: root, encoding: "utf8", shell: WIN, timeout: 20000 });
      return r.status === 0 ? ["ok", `GitHub repo ${r.stdout.trim()}`] : ["FIX", "gh repo view fails for this repo's remote", "git remote -v; gh repo view"];
    });
    if (!hive) {
      check(() => ["WARN", "not a hivemind project (no teams/)", `${self} --project`]);
    } else {
      check(() => isFile(path.join(root, "teams", "ROUTING.md")) ? ["ok", "teams/ROUTING.md"]
        : ["WARN", "teams/ROUTING.md missing", `${self} --project`]);
      check(() => {
        const s = readJson(path.join(root, ".claude", "settings.local.json"));
        const hooks = JSON.stringify((s && s.hooks) || {});
        const miss = ["hive-autostart.js", "hive-lead-guard.js"].filter((f) => !hooks.includes(f) || !isFile(path.join(root, ".claude", "hooks", f)));
        return miss.length ? ["FIX", `lead hooks not registered: ${miss.join(", ")}`, `${self} --project`] : ["ok", "lead hooks registered"];
      }, () => registerHooks(root));
      check(() => {
        const r = spawnSync(process.execPath, [path.join(HERE, "templates", "hooks", "hive-scratch.js"), "--size"], { cwd: root, encoding: "utf8", timeout: 60000 });
        const mb = parseFloat(r.stdout);
        if (r.status !== 0 || !Number.isFinite(mb)) return ["WARN", "scratch size unknown", "node .claude/hooks/hive-scratch.js --size"];
        return mb > 1024 ? ["WARN", `hive scratch holds ${mb} MB`, "node .claude/hooks/hive-scratch.js --sweep --all-done"] : ["ok", `hive scratch ${mb} MB`];
      });
      check(() => {
        const teams = path.join(root, "teams");
        const unlinked = L.profiles(teams).map((p) => [p, L.listFiles(path.join(teams, p)).flatMap(L.readList)
          .filter(([, name]) => name && !real(path.join(teams, p, ".claude", "skills", name))).length]).filter(([, n]) => n);
        return unlinked.length ? ["FIX", `team skills not linked (${unlinked.map(([p, n]) => `${p} ${n}`).join(", ")})`, `node "${path.join(HERE, "teams", "link-skills.js")}" --install`]
          : ["ok", "team skills linked"];
      }, () => L.run({ root, log }));
    }
  }

  let failing = 0;
  for (const c of checks) {
    let r = await c.test();
    if (r[0] === "FIX" && fix && c.fixFn) {
      quiet = true;
      try { c.fixFn(); } catch (e) { warn(`fix failed: ${e.message}`); } finally { quiet = false; }
      r = await c.test();
      if (r[0] !== "FIX") r[1] += " (fixed)";
    }
    if (r[0] === "FIX") failing++;
    console.log(`${r[0].padEnd(4)} ${r[1]}${r[0] === "ok" ? "" : ` — ${r[2]}`}`);
  }
  console.log(failing ? `\n${failing} to fix${fix ? "" : "; --doctor --fix applies the local ones"}` : "\nall good");
  return failing === 0;
}

// main

const FLAGS = {
  "--project": "project", "--install": "install", "--confine": "confine", "--update": "update",
  "--doctor": "doctor", "--fix": "fix", "--auto-update": "autoUpdate", "--no-auto-update": "noAutoUpdate",
};
const argv = process.argv.slice(2);
const opt = {};
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--laya" || a.startsWith("--laya=")) {
    opt.laya = a === "--laya" ? argv[++i] : a.slice("--laya=".length);
    if (!opt.laya || (opt.laya !== "setup" && !parseLaya(opt.laya))) die(`--laya takes an http(s) URL, "off" or "setup", not: ${opt.laya ?? "nothing"}`, 2);
    continue;
  }
  if (a === "-h" || a === "--help") {
    const lines = fs.readFileSync(__filename, "utf8").split(/\r?\n/).slice(1);
    console.log(lines.slice(0, lines.findIndex((l) => !l.startsWith("//"))).map((l) => l.slice(3)).join("\n"));
    process.exit(0);
  }
  if (!FLAGS[a]) die(`unknown flag: ${a} (--help lists them)`, 2);
  opt[FLAGS[a]] = true;
}
if ((opt.install || opt.confine) && !opt.project) die("--install/--confine need --project", 2);
if (opt.fix && !opt.doctor) die("--fix needs --doctor", 2);
if (opt.doctor && Object.keys(opt).some((k) => k !== "doctor" && k !== "fix")) die("--doctor takes only --fix", 2);
if (opt.autoUpdate && opt.noAutoUpdate) die("--auto-update and --no-auto-update conflict", 2);
if (opt.laya === "setup" && Object.keys(opt).length > 1) die("--laya setup takes no other flags", 2);

(async () => {
  if (opt.doctor) process.exitCode = (await doctor(opt.fix)) ? 0 : 1;
  else if (opt.laya === "setup") process.exitCode = layaSetup() ? 0 : 1;
  else if (opt.update) update(argv);
  else process.exitCode = install(opt) ? 0 : 1;
})().catch((e) => die(`error: ${e.message}`));
