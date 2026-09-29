// Installer delete-guard contract (#13): no install.js run removes or changes anything outside the target's Proteus-owned paths,
// every delete in install.js goes through safeRemove, and tests/lib.js workdir() refuses a TMPDIR inside a git worktree.
// Every temp dir, the fake "real home" F included, is an fs.mkdtempSync under os.tmpdir(), checked to be outside the user's home
// before anything is spawned; the installer run is a clone of the checkout there with its uncommitted edits committed, and every
// run gets an explicit fake HOME and CODEX_HOME, a fake gh and claude, and no network. Case 3 reads install.js; the rest spawn.
// PROTEUS_SAFETY_SRC overrides the checkout cloned and read, for tests only.
// Exit 0 if every assertion passed, 1 otherwise; exit 1 before any spawn when os.tmpdir() is inside the user's home.
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { ok, summary } = require(path.join(__dirname, "lib.js"));

const SRC = path.resolve(process.env.PROTEUS_SAFETY_SRC || path.join(__dirname, ".."));
// any shipped agent works; the ticket's proteus-lead.md is not one
const AGENT = "proteus-worker.md";

const real = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
const under = (p, dir) => { const r = path.relative(dir, p); return r === "" || (!r.startsWith("..") && !path.isAbsolute(r)); };
const HOMES = [os.userInfo().homedir, process.env.HOME].flatMap((h) => (h ? [real(h)] : []));
const lstat = (p) => { try { return fs.lstatSync(p); } catch { return null; } };
const read = (p) => { try { return fs.readFileSync(p); } catch { return null; } };

// a fresh dir under os.tmpdir(); inside the user's home it is removed and the file stops before any spawn
const made = [];
function tmp(tag) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), `proteus-safety-${tag}-`));
  if (HOMES.some((h) => under(real(d), h))) {
    fs.rmdirSync(d);
    console.log(`FAIL ${d} is inside the user's home; run with TMPDIR outside it`);
    process.exit(1);
  }
  made.push(d);
  return d;
}

const TOOLS = tmp("tools");
const BIN = path.join(TOOLS, "bin");
fs.mkdirSync(BIN);
fs.symlinkSync(process.execPath, path.join(BIN, "node"));
fs.copyFileSync(path.join(__dirname, "fakegh.js"), path.join(BIN, "gh"));
fs.chmodSync(path.join(BIN, "gh"), 0o755);
// fake claude: records the context-mode plugin the way the real CLI does, in the fake HOME
const CTX = "context-mode@context-mode";
fs.writeFileSync(path.join(BIN, "claude"), `#!${process.execPath}
const fs = require("fs"), path = require("path"), os = require("os");
const a = process.argv.slice(2).join(" ");
const d = path.join(os.homedir(), ".claude"), rd = (f) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return {}; } };
fs.mkdirSync(path.join(d, "plugins"), { recursive: true });
if (a === "plugin marketplace add mksglu/context-mode") fs.writeFileSync(path.join(d, "plugins", "known_marketplaces.json"), JSON.stringify({ "context-mode": {} }));
if (a === "plugin install ${CTX} --scope user") fs.writeFileSync(path.join(d, "plugins", "installed_plugins.json"), JSON.stringify({ version: 2, plugins: { "${CTX}": [{ scope: "user" }] } }));
if (a === "plugin install ${CTX} --scope user" || a === "plugin enable ${CTX} --scope user") {
  const s = rd(path.join(d, "settings.json")); s.enabledPlugins = { ...s.enabledPlugins, "${CTX}": true }; fs.writeFileSync(path.join(d, "settings.json"), JSON.stringify(s));
}
`, { mode: 0o755 });

// PATH leaves out node's own bin dir, which may hold a real codex or claude
const envFor = (home) => ({
  PATH: [BIN, "/usr/bin", "/bin"].join(path.delimiter), HOME: home, USERPROFILE: home, CODEX_HOME: path.join(home, ".codex"),
  GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t",
});
const git = (args, cwd, input) => spawnSync("git", args, { cwd, env: envFor(TOOLS), encoding: "utf8", input, maxBuffer: 1 << 28 });

// the installer under test: SRC cloned (with its uncommitted edits) to ORIGIN on main, cloned again to CHK so --update can pull
const ORIGIN = path.join(TOOLS, "origin"), CHK = path.join(TOOLS, "proteus");
let step = git(["clone", "--quiet", SRC, ORIGIN], TOOLS);
const diff = git(["diff", "HEAD", "--binary"], SRC);
if (step.status === 0 && diff.stdout) {
  step = git(["apply", "--index"], ORIGIN, diff.stdout);
  if (step.status === 0) step = git(["commit", "--quiet", "--no-verify", "-m", "uncommitted changes"], ORIGIN);
}
if (step.status === 0) step = git(["checkout", "--quiet", "-B", "main"], ORIGIN);
if (step.status === 0) step = git(["clone", "--quiet", ORIGIN, CHK], TOOLS);
ok("the checkout clones into a temp dir", step.status === 0, step.stderr);

function installer(args, cwd, home) {
  if (HOMES.some((h) => under(real(home), h) || under(real(cwd), h))) throw new Error(`refusing to run install.js with ${home} or ${cwd} inside the user's home`);
  return spawnSync(process.execPath, [path.join(CHK, "install.js"), ...args], { cwd, env: envFor(home), encoding: "utf8", timeout: 180000 });
}

// F stands in for a real home: a shipped agent copy and a proteus skill link in F/.claude, the fake HOME at F/fakehome
function fakeRealHome(tag) {
  const F = tmp(tag);
  const agents = path.join(F, ".claude", "agents"), skills = path.join(F, ".claude", "skills");
  fs.mkdirSync(agents, { recursive: true });
  fs.mkdirSync(skills, { recursive: true });
  fs.copyFileSync(path.join(CHK, "agents", AGENT), path.join(agents, AGENT));
  fs.symlinkSync(path.join(CHK, "skills", "proteus"), path.join(skills, "proteus"), "junction");
  const home = path.join(F, "fakehome");
  for (const d of [".claude", ".agents", ".codex"]) fs.mkdirSync(path.join(home, d), { recursive: true });
  fs.mkdirSync(path.join(F, "work"));
  const f = { F, home, agent: path.join(agents, AGENT), link: path.join(skills, "proteus") };
  // a copy that differs from the shipped one is an override the installer keeps anyway: the case would measure nothing
  const shipped = read(path.join(CHK, "agents", AGENT));
  ok(`F's ${AGENT} is byte-identical to the shipped copy (${tag})`, !!shipped && shipped.equals(read(f.agent)));
  return f;
}

function intact(f, when) {
  ok(`F's shipped agent copy survives ${when}`, !!lstat(f.agent));
  const st = lstat(f.link);
  ok(`F's .claude/skills/proteus link survives ${when}`, !!st && st.isSymbolicLink());
}

// every path under root except skip, with its type, size or link target, and mtime
function snapshot(root, skip) {
  const out = new Map([[".", `dir:${fs.lstatSync(root).mtimeMs}`]]);
  const walk = (d) => {
    for (const name of fs.readdirSync(d).sort()) {
      const p = path.join(d, name);
      if (skip.includes(p)) continue;
      const st = fs.lstatSync(p);
      const kind = st.isSymbolicLink() ? `link:${fs.readlinkSync(p)}` : st.isDirectory() ? "dir" : `file:${st.size}`;
      out.set(path.relative(root, p), `${kind}:${st.mtimeMs}`);
      if (st.isDirectory()) walk(p);
    }
  };
  walk(root);
  return out;
}

function drift(a, b) {
  const out = [];
  for (const [k, v] of a) {
    if (!b.has(k)) out.push(`removed ${k}`);
    else if (b.get(k) !== v) out.push(`changed ${k}`);
  }
  for (const k of b.keys()) if (!a.has(k)) out.push(`added ${k}`);
  return out;
}

// [start, end) of a function's body in source text, braces matched; null when it is not defined
function fnBody(text, name) {
  const m = new RegExp(`function ${name}\\s*\\(`).exec(text);
  if (!m) return null;
  let i = m.index + m[0].length, depth = 1;
  for (; i < text.length && depth; i++) depth += text[i] === "(" ? 1 : text[i] === ")" ? -1 : 0;
  const open = text.indexOf("{", i);
  if (open < 0) return null;
  depth = 1;
  for (i = open + 1; i < text.length && depth; i++) depth += text[i] === "{" ? 1 : text[i] === "}" ? -1 : 0;
  return depth ? null : [open, i];
}

try {
  if (step.status === 0) {
    // case 1, walk: the doctor's dupe walk from F/work/plain (not a repo) must not reach F
    const f = fakeRealHome("walk");
    const plain = path.join(f.F, "work", "plain");
    fs.mkdirSync(plain);
    const r = installer(["--doctor", "--fix"], plain, f.home);
    ok("install.js --doctor --fix from F/work/plain runs to its report", /^(\d+ to fix|all good)/m.test(r.stdout || ""), `${r.status} ${r.stderr}${r.stdout}`);
    intact(f, "install.js --doctor --fix run from F/work/plain");

    // case 2, takeover and refresh: install, --update and --project in a repo under F touch only the fake HOME and the repo
    const t = fakeRealHome("takeover");
    const repo = path.join(t.F, "work", "repo");
    fs.mkdirSync(repo);
    fs.writeFileSync(path.join(repo, "README.md"), "# repo\n");
    let g = git(["init", "--quiet"], repo);
    if (g.status === 0) g = git(["add", "README.md"], repo);
    if (g.status === 0) g = git(["commit", "--quiet", "--no-verify", "-m", "init"], repo);
    ok("a repo under F/work is set up", g.status === 0, g.stderr);
    const skip = [...[".claude", ".agents", ".codex"].map((d) => path.join(t.home, d)), repo];
    const before = snapshot(t.F, skip);
    for (const args of [[], ["--update"], ["--project"], ["--update"]]) {
      const r2 = installer(args, repo, t.home);
      ok(`install.js ${args.join(" ") || "(no flags)"} in a repo under F exits 0`, r2.status === 0, `${r2.status} ${r2.stderr}${r2.stdout}`);
    }
    const moved = drift(before, snapshot(t.F, skip));
    ok("nothing in F outside the fake HOME's .claude, .agents, .codex and the repo is removed or changed", !moved.length, moved.join(", "));
    intact(t, "install.js, --update and --project in a repo under F");
  }

  // case 3, grep: every rmSync, unlinkSync and rmdirSync in install.js sits inside safeRemove
  const text = fs.readFileSync(path.join(SRC, "install.js"), "utf8");
  const body = fnBody(text, "safeRemove");
  const stray = [];
  for (const m of text.matchAll(/\b(rmSync|unlinkSync|rmdirSync)\b/g)) {
    if (!body || m.index < body[0] || m.index >= body[1]) stray.push(`install.js:${text.slice(0, m.index).split("\n").length} ${m[1]}`);
  }
  ok("install.js defines function safeRemove", !!body);
  ok("rmSync, unlinkSync and rmdirSync appear in install.js only inside safeRemove", !stray.length, stray.join(", "));

  // case 4, workdir: a test file whose os.tmpdir() is inside a git worktree stops before it creates anything
  const w = tmp("repo");
  const init = git(["init", "--quiet"], w);
  ok("a temp git repo for TMPDIR is set up", init.status === 0, init.stderr);
  const bad = path.join(w, "tmp");
  fs.mkdirSync(bad);
  const r = spawnSync(process.execPath, [path.join(__dirname, "fixtures", "workdir-probe.js"), path.join(SRC, "tests", "lib.js")], {
    cwd: w, env: { ...envFor(path.join(w, "home")), TMPDIR: bad, TMP: bad, TEMP: bad }, encoding: "utf8", timeout: 60000,
  });
  const said = `${r.stdout}${r.stderr}`;
  ok("workdir() exits non-zero when os.tmpdir() is inside a git worktree", r.status !== 0 && r.status !== null, `${r.status} ${said}`);
  ok("workdir()'s refusal names the misplaced tmpdir", r.status !== 0 && (said.includes(bad) || said.includes(real(bad))), said);
  ok("workdir()'s refusal is a message, not a crash", r.status !== 0 && !/\n\s+at /.test(r.stderr || ""), r.stderr);
  ok("workdir() creates nothing under the misplaced tmpdir", !lstat(path.join(bad, "proteus-test")));
} finally {
  for (const d of made) fs.rmSync(d, { recursive: true, force: true });
}

summary();
