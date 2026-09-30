// Shared harness for tests/*.test.js: assertions, a hermetic temp dir per call (sandbox) or per file (workdir), fake gh and claude, spawn helpers.
// summary() prints "N passed, M failed" and sets exit code 1 if any assertion failed, else 0; with no failures it also removes the workdir.
// sandbox() and workdir() exit 1 with a message, before writing anything, when os.tmpdir() is in the user's home or a git worktree,
// and throw, before writing anything, on a tag or name outside /^[a-z0-9-]+$/.
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawnSync, execFileSync } = require("child_process");

const TAG = /^[a-z0-9-]+$/;
const INSTALL = path.join(__dirname, "..", "install.js");
const FAKES = [["gh", "fakegh.js"], ["claude", "fakeclaude.js"]];
const SPAWN_MS = 120000, GIT_MS = 60000;

let pass = 0, fail = 0;
let W, HOME, BIN, ENV;

function need() {
  if (!W) throw new Error("call workdir(name) first");
}

// a tmpdir in the real home or in a git worktree puts the installer's walks next to real files (#13): stop before any write.
// realpathSync.native expands an 8.3 name (C:\Users\RUNNER~1) that the js realpath leaves short, so the home check still matches
function refuseTmpdir() {
  const real = (p) => { try { return fs.realpathSync.native(p); } catch { return path.resolve(p); } };
  const inside = (child, parent) => { const r = path.relative(parent, child); return r === "" || (!r.startsWith("..") && !path.isAbsolute(r)); };
  const tmp = real(os.tmpdir());
  let why = null;
  try { if (inside(tmp, real(os.userInfo().homedir))) why = `inside your home ${os.userInfo().homedir}`; } catch {}
  for (let d = tmp; !why; d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, ".git"))) why = `inside the git worktree ${d}`;
    if (path.dirname(d) === d) break;
  }
  if (!why) return;
  console.error(`refusing to run: os.tmpdir() ${os.tmpdir()} is ${why}; run with TMPDIR outside it (the default /tmp)`);
  process.exit(1);
}

// PATH after the fakes and node: the OS dirs, plus git's own dir on windows, where it lives outside them
function systemDirs(win) {
  if (!win) return ["/usr/bin", "/bin"];
  const root = process.env.SystemRoot || "C:\\Windows";
  const git = (process.env.PATH || "").split(path.delimiter).find((d) => d && fs.existsSync(path.join(d, "git.exe")));
  return [path.join(root, "System32"), root, ...(git ? [git] : [])];
}

// each fake as a node script; on win32 a .cmd shim beside it, since PATH lookup there finds gh.cmd, never an extensionless file
function installFakes(bin, win, fakes) {
  for (const [name, src] of fakes) {
    const from = path.join(__dirname, src);
    if (!win) { fs.copyFileSync(from, path.join(bin, name)); fs.chmodSync(path.join(bin, name), 0o755); continue; }
    fs.copyFileSync(from, path.join(bin, `${name}.js`));
    fs.writeFileSync(path.join(bin, `${name}.cmd`), `@echo off\r\nnode "%~dp0${name}.js" %*\r\n`);
  }
}

function hashFile(p) {
  try { return crypto.createHash("sha1").update(fs.readFileSync(p)).digest("hex"); } catch { return "unreadable"; }
}

// every path under root, relative with "/" separators: sha1 for a file, "->target" for a link (never followed), "dir" for a dir
function snapshot(root) {
  const m = new Map();
  const walk = (d) => {
    let names = [];
    try { names = fs.readdirSync(d).sort(); } catch { return; }
    for (const n of names) {
      const p = path.join(d, n), rel = path.relative(root, p).split(path.sep).join("/");
      let st;
      try { st = fs.lstatSync(p); } catch { continue; }
      if (st.isSymbolicLink()) { let t = ""; try { t = fs.readlinkSync(p); } catch {} m.set(rel, `->${t}`); }
      else if (st.isDirectory()) { m.set(rel, "dir"); walk(p); }
      else m.set(rel, hashFile(p));
    }
  };
  walk(root);
  return m;
}

// changed, added and removed paths between two snapshots, sorted
function drift(before, after) {
  return [...new Set([...before.keys(), ...after.keys()])].sort().filter((k) => before.get(k) !== after.get(k));
}

// one hermetic temp dir per call, with fake gh and claude on PATH (#35)
function sandbox(tag) {
  return makeSandbox(tag, FAKES);
}

function makeSandbox(tag, fakes) {
  refuseTmpdir();
  if (typeof tag !== "string" || !TAG.test(tag)) throw new Error(`sandbox tag ${JSON.stringify(tag)} must match ${TAG}`);
  const win = process.platform === "win32";
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `proteus-${tag}-`));
  const home = path.join(dir, "home"), bin = path.join(dir, "bin");
  fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
  fs.mkdirSync(path.join(home, ".codex"), { recursive: true });
  fs.mkdirSync(bin);
  installFakes(bin, win, fakes);
  const env = {
    PATH: [bin, path.dirname(process.execPath), ...systemDirs(win)].join(path.delimiter),
    HOME: home, USERPROFILE: home, CODEX_HOME: path.join(home, ".codex"),
    // git for windows maps /dev/null to its null device itself
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t",
  };
  // cmd.exe and the .cmd shims need these; nothing else of the real env comes through
  if (win) for (const k of ["SystemRoot", "ComSpec", "PATHEXT"]) if (process.env[k]) env[k] = process.env[k];
  const installer = (args = [], opts = {}) => {
    const r = spawnSync(process.execPath, [INSTALL, ...args], {
      cwd: opts.cwd || dir, env: { ...env, ...opts.env }, input: opts.input || "", encoding: "utf8", windowsHide: true, timeout: SPAWN_MS,
    });
    return { code: r.status, out: r.stdout || "", err: `${r.stderr || ""}${r.error ? r.error.message : ""}` };
  };
  const git = (cwd, ...args) => execFileSync("git", args, { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true, timeout: GIT_MS }).trim();
  const cleanup = () => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  return { dir, home, bin, env, installer, git, snapshot, drift, cleanup };
}

// the per-file dir the older suites share through W, HOME, BIN and ENV; a sandbox, so concurrent runs no longer collide.
// BIN keeps only the fake gh, as before: those suites write their own claude, and some need none on PATH
function workdir(name) {
  const s = makeSandbox(name, FAKES.filter(([n]) => n === "gh"));
  W = s.dir;
  HOME = s.home;
  BIN = s.bin;
  ENV = s.env;
  return W;
}

function ok(name, cond, extra) {
  if (cond) pass++; else { fail++; console.log(`FAIL ${name}${extra ? " :: " + String(extra).slice(0, 600) : ""}`); }
}

function run(script, input, { cwd = process.cwd(), env = {}, args = [] } = {}) {
  need();
  const t = process.hrtime.bigint();
  const r = spawnSync(process.execPath, [script, ...args], { cwd, input: typeof input === "string" ? input : JSON.stringify(input || {}), env: { ...ENV, CLAUDE_PROJECT_DIR: cwd, ...env }, encoding: "utf8", windowsHide: true, timeout: SPAWN_MS });
  return { code: r.status, out: r.stdout, err: r.stderr, ms: Number(process.hrtime.bigint() - t) / 1e6 };
}

function g(cwd, ...args) {
  need();
  return execFileSync("git", args, { cwd, env: ENV, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true, timeout: GIT_MS }).trim();
}

function summary() {
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
  // a failed run keeps its workdir to inspect
  if (!fail && W) try { fs.rmSync(W, { recursive: true, force: true, maxRetries: 3 }); } catch {}
}

module.exports = {
  ok, run, g, workdir, sandbox, summary,
  get ENV() { need(); return ENV; },
  get BIN() { need(); return BIN; },
  get HOME() { need(); return HOME; },
  get W() { need(); return W; },
};
