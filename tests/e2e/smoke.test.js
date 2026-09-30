// End-to-end smoke (#39): a fresh machine in one sandbox, six steps in order, from a committed copy of this checkout
// with a local bare upstream: install, project, hive-era migration, doctor, autostart, update. Fake gh and claude, no network.
// Prints "N passed, M failed" and exits 1 if any step failed; on win32 without pwsh it prints why and skips with exit 0.
"use strict";
const fs = require("fs");
const os = require("os");
const net = require("net");
const path = require("path");
const crypto = require("crypto");
const { spawnSync, execFileSync } = require("child_process");
const { ok, sandbox, summary } = require(path.join(__dirname, "..", "lib.js"));

const ROOT = path.join(__dirname, "..", "..");
const FIXTURE = path.join(__dirname, "..", "fixtures", "hive-era");
const WIN = process.platform === "win32";
const PS = { "--install": "-Install", "--project": "-Project", "--doctor": "-Doctor", "--fix": "-Fix", "--update": "-Update" };

const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8", windowsHide: true, timeout: 30000 }).split("\0").filter(Boolean);
const sha = crypto.createHash("sha1").update(fs.readFileSync(path.join(ROOT, "install.js"))).digest("hex");
console.log(`${path.resolve(ROOT)}: e2e smoke on ${tracked.length} tracked files, install.js sha1 ${sha}`);

const pwsh = WIN && (process.env.PATH || "").split(path.delimiter).map((d) => path.join(d, "pwsh.exe")).find((p) => fs.existsSync(p));
if (WIN && !pwsh) {
  console.log("skipped: pwsh not found on PATH; the win32 steps run install.ps1 through it");
  summary();
  process.exit();
}

// mtimes of the real homes where an install lands; ~/.claude itself and proteus.json change under any live session
const REAL = os.userInfo().homedir;
const WATCH = [".claude/skills", ".claude/agents", ".codex", ".pi"];
const mtimes = () => WATCH.map((p) => { try { return `${p} ${fs.lstatSync(path.join(REAL, p)).mtimeMs}`; } catch { return `${p} absent`; } });
const realBefore = mtimes();

// a port that was just free and is now closed: every proxied request fails at once
function closedPort() {
  return new Promise((done) => { const srv = net.createServer().listen(0, "127.0.0.1", () => { const { port } = srv.address(); srv.close(() => done(port)); }); });
}
function refused(port) {
  return new Promise((done) => { const c = net.connect(port, "127.0.0.1"); c.on("connect", () => { c.destroy(); done(false); }); c.on("error", () => done(true)); });
}

const s = sandbox("e2e-smoke");
const { git } = s;
const read = (...p) => { try { return fs.readFileSync(path.join(...p), "utf8"); } catch { return null; } };
const rows = (out, tag) => out.split(/\r?\n/).filter((l) => l.startsWith(`${tag} `));

// fake gh for the doctor: logged in, the sample repo on GitHub; every other call goes to tests/fakegh.js
fs.writeFileSync(path.join(s.bin, WIN ? "gh.js" : "gh"), `#!${process.execPath}
const a = process.argv.slice(2);
if (a[0] === "--version") { process.stdout.write("gh version 2.0.0\\n"); process.exit(0); }
if (a[0] === "auth" && a[1] === "status") process.exit(0);
if (a[0] === "repo" && a[1] === "view") { process.stdout.write("example/sample\\n"); process.exit(0); }
const r = require("child_process").spawnSync(process.execPath, [${JSON.stringify(path.join(__dirname, "..", "fakegh.js"))}, ...a], { stdio: "inherit" });
process.exit(r.status === null ? 1 : r.status);
`, { mode: 0o755 });
// the plugin the doctor requires, as /plugin install leaves it
fs.mkdirSync(path.join(s.home, ".claude", "plugins", "cache", "claude-plugins-official", "mattpocock-skills", "1.0.0", "skills"), { recursive: true });

// the checkout under test: this working tree, committed, tracking a local bare upstream that is one commit ahead
const PH = path.join(s.dir, "proteus"), UB = path.join(s.dir, "upstream.git"), UA = path.join(s.dir, "upstream-work");
for (const f of tracked) {
  if (!fs.existsSync(path.join(ROOT, f))) continue;
  fs.mkdirSync(path.dirname(path.join(PH, f)), { recursive: true });
  fs.copyFileSync(path.join(ROOT, f), path.join(PH, f));
}
git(PH, "init", "-q", "-b", "main");
git(PH, "add", "-A");
git(PH, "commit", "-qm", "chore: checkout under test");
git(s.dir, "clone", "-q", "--bare", PH, UB);
git(PH, "remote", "add", "origin", UB);
git(PH, "fetch", "-q", "origin");
git(PH, "branch", "-q", "-u", "origin/main");
git(s.dir, "clone", "-q", UB, UA);
git(UA, "commit", "-q", "--allow-empty", "-m", "chore: upstream moves on");
git(UA, "push", "-q", "origin", "main");

function sampleRepo(name) {
  const d = path.join(s.dir, name);
  git(s.dir, "init", "-q", "-b", "main", d);
  fs.writeFileSync(path.join(d, "README.md"), `${name}\n`);
  git(d, "add", "-A");
  git(d, "commit", "-qm", "init");
  git(d, "remote", "add", "origin", `https://github.com/example/${name}.git`);
  return d;
}

// every path under the repo but the index, which any git status may rewrite
const repoState = (d) => { const m = s.snapshot(d); m.delete(".git/index"); return m; };
const walk = (d, rel = "") => fs.readdirSync(path.join(d, rel)).flatMap((n) => {
  const r = rel ? `${rel}/${n}` : n;
  if (r === ".git") return [];
  return fs.lstatSync(path.join(d, r)).isDirectory() ? [r, ...walk(d, r)] : [r];
});

(async () => {
  const port = await closedPort();
  const proxy = `http://127.0.0.1:${port}`;
  const E = { ...s.env, CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1", https_proxy: proxy, HTTPS_PROXY: proxy, http_proxy: proxy, HTTP_PROXY: proxy };
  ok(`network: https_proxy ${E.https_proxy} in the child env is a closed port`, /^http:\/\/127\.0\.0\.1:\d+$/.test(E.https_proxy) && await refused(port), E.https_proxy);

  const inst = (flags, cwd) => {
    const r = WIN
      ? spawnSync(pwsh, ["-NoProfile", "-File", path.join(PH, "install.ps1"), ...flags.map((f) => PS[f])], { cwd, env: E, encoding: "utf8", windowsHide: true, timeout: 300000 })
      : spawnSync(process.execPath, [path.join(PH, "install.js"), ...flags], { cwd, env: E, encoding: "utf8", windowsHide: true, timeout: 300000 });
    return { code: r.status, out: r.stdout || "", all: `${r.stdout || ""}${r.stderr || ""}${r.error ? r.error.message : ""}` };
  };
  const fixRows = (r) => rows(r.out, "FIX").join(" | ") || r.all.slice(-600);

  // 1. fresh install
  let r = inst(["--install"], s.dir);
  ok("1 install: --install exits 0", r.code === 0, r.all.slice(-600));
  const link = path.join(s.home, ".claude", "skills", "proteus");
  let target = "";
  try { target = fs.realpathSync(link); } catch {}
  ok("1 install: the fake ~/.claude/skills/proteus resolves to the checkout's skills/proteus", target === fs.realpathSync(path.join(PH, "skills", "proteus")), target || "missing");
  const shipped = fs.readdirSync(path.join(PH, "agents")).filter((f) => /^proteus-.*\.md$/.test(f));
  const lacking = shipped.filter((f) => read(s.home, ".claude", "agents", f) === null);
  ok(`1 install: the fake ~/.claude/agents holds all ${shipped.length} shipped proteus-* agents`, shipped.length > 0 && !lacking.length, lacking.join(", "));

  // 2. project
  const A = sampleRepo("sample");
  r = inst(["--project"], A);
  ok("2 project: --project exits 0", r.code === 0, r.all.slice(-600));
  ok("2 project: the repo has teams/ROUTING.md", fs.existsSync(path.join(A, "teams", "ROUTING.md")));
  const settings = JSON.parse(read(A, ".claude", "settings.local.json") || "{}");
  const starts = ((settings.hooks && settings.hooks.SessionStart) || []).flatMap((e) => (e && e.hooks) || []).map((h) => String(h.command));
  const auto = starts.find((c) => c.includes("proteus-autostart.js"));
  ok("2 project: .claude/settings.local.json registers the autostart as a SessionStart hook", !!auto, JSON.stringify(settings.hooks || {}).slice(0, 400));

  // 3. hive-era migration
  // _git/ and _claude/ in the fixture are .git/ and .claude/, which git cannot track or a global ignore drops
  const H = sampleRepo("legacy");
  for (const f of walk(FIXTURE)) {
    const from = path.join(FIXTURE, f), to = path.join(H, f.replace(/^_(git|claude)(\/|$)/, ".$1$2"));
    if (fs.statSync(from).isDirectory()) fs.mkdirSync(to, { recursive: true });
    else fs.copyFileSync(from, to);
  }
  ok("3 migrate: the hive-era fixture is in place (a hive-* hook, .git/hive)", fs.existsSync(path.join(H, ".claude", "hooks", "hive-autostart.js")) && fs.existsSync(path.join(H, ".git", "hive", "journal.jsonl")));
  r = inst(["--project"], H);
  ok("3 migrate: --project in the hive-era repo exits 0", r.code === 0, r.all.slice(-600));
  const hive = [...walk(H).filter((f) => /hive/i.test(f)), ...(fs.existsSync(path.join(H, ".git", "hive")) ? [".git/hive"] : [])];
  for (const f of [".claude/settings.local.json", ".git/info/exclude"]) if (/hive/i.test(read(H, f) || "")) hive.push(`${f} (content)`);
  ok("3 migrate: nothing named hive remains in managed files", !hive.length, hive.join(", "));
  ok("3 migrate: the hive-era journal moved to .git/proteus byte for byte", read(H, ".git", "proteus", "journal.jsonl") === read(FIXTURE, "_git", "hive", "journal.jsonl"), read(H, ".git", "proteus", "journal.jsonl"));
  const before = repoState(H);
  r = inst(["--project"], H);
  const changed = s.drift(before, repoState(H));
  ok("3 migrate: a second --project exits 0 and is a no-op (drift is empty)", r.code === 0 && !changed.length, `${r.code} ${changed.slice(0, 8).join(" | ")}`);

  // 4. doctor: the user installs the skills --project listed, then lets --doctor --fix link them (the #37 fix)
  const names = new Set();
  for (const p of fs.readdirSync(path.join(A, "teams"))) {
    for (const f of ["required.txt", "skills.txt"]) {
      for (const l of (read(A, "teams", p, f) || "").split(/\r?\n/)) { const m = /^\s*[^#\s]\S*\s+(\S+)/.exec(l); if (m) names.add(m[1]); }
    }
  }
  for (const n of names) {
    fs.mkdirSync(path.join(s.home, ".claude", "skills", n), { recursive: true });
    fs.writeFileSync(path.join(s.home, ".claude", "skills", n, "SKILL.md"), `---\nname: ${n}\ndescription: fake\n---\n`);
  }
  r = inst(["--doctor", "--fix"], A);
  r = inst(["--doctor"], A);
  ok(`4 doctor: after --doctor --fix links the ${names.size} team skills, --doctor prints no FIX row and exits 0`, r.code === 0 && !rows(r.out, "FIX").length && names.size > 0, fixRows(r));

  // 5. autostart
  const payload = JSON.stringify({ session_id: "e2e-smoke", hook_event_name: "SessionStart", source: "startup", cwd: A });
  const a = auto ? spawnSync(auto, { cwd: A, env: { ...E, CLAUDE_PROJECT_DIR: A }, input: payload, shell: true, encoding: "utf8", windowsHide: true, timeout: 120000 }) : { stdout: "", stderr: "no autostart registered" };
  ok("5 autostart: the registered SessionStart command prints proteus autostart:", /proteus autostart:/.test(a.stdout || ""), `${a.stdout || ""}${a.stderr || ""}`.slice(-600));

  // 6. update
  const ahead = git(UB, "rev-parse", "main");
  r = inst(["--update"], A);
  ok("6 update: --update exits 0 and fast-forwards the checkout from its upstream", r.code === 0 && git(PH, "rev-parse", "HEAD") === ahead, r.all.slice(-600));
  r = inst(["--doctor"], A);
  ok("6 update: --doctor still prints no FIX row and exits 0", r.code === 0 && !rows(r.out, "FIX").length, fixRows(r));

  const realAfter = mtimes();
  ok("isolation: the real ~/.claude/skills, ~/.claude/agents, ~/.codex and ~/.pi mtimes are unchanged", realBefore.join() === realAfter.join(), `${realBefore.join(", ")} -> ${realAfter.join(", ")}`);

  summary();
  if (!process.exitCode) s.cleanup();
})();
