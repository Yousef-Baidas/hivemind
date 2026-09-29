// Migration contract (#6): a repo already on Proteus keeps its hive-era state after the rename (#5).
// Legacy fixtures in one mkdtemp dir under os.tmpdir(): repos with an open hive/<run> run (packed refs, as git gc leaves
// them), .git/hive/ state and journal, hive labels in a stateful fake gh, a Codex config.toml naming ../<repo>-hive, and a
// fake HOME installed from main at 7d3d544 then fast-forwarded by its own autostart. One case per contract item: the
// Check, the auto-update path, and Addendum 2 items 1-4. PROTEUS_MIGRATE_SRC overrides the checkout under test (tests
// only). Never the network, the real ~/.claude, ~/.codex or ~/.pi, or a write to the checkout.
// Exit 0 if every assertion passed, 1 otherwise.
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawnSync, execFileSync } = require("child_process");
const lib = require(path.join(__dirname, "lib.js"));
const { ok, g, summary } = lib;

const ROOT = path.join(__dirname, "..");
const SRC = path.resolve(process.env.PROTEUS_MIGRATE_SRC || ROOT);
const OLD_MAIN = "7d3d544"; // main before the rename: proteus-*.js hooks on .git/hive state and hive/* branches
const RUN = "demo";
const PROMPT = "keep the demo run on sqlite, not postgres";
const JOURNAL = [
  { ts: "2026-09-28T10:00:00.000Z", session_id: "s0", prompt: "start the demo run" },
  { ts: "2026-09-28T10:05:00.000Z", session_id: "s0", prompt: PROMPT },
].map((l) => JSON.stringify(l) + "\n").join("");

lib.workdir("migrate");
const T = fs.mkdtempSync(path.join(os.tmpdir(), "proteus-migrate-"));
const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: SRC, encoding: "utf8", windowsHide: true, timeout: 30000 }).split("\0").filter(Boolean);
console.log(`${T}: legacy fixtures; checkout under test ${SRC} (${tracked.length} tracked files)`);

// ---- fakes: claude (the context-mode plugin, in the fake HOME) and a stateful gh (issues, labels, PRs in DB)
const CTX = "context-mode@context-mode";
fs.writeFileSync(path.join(lib.BIN, "claude"), `#!${process.execPath}
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
const GBIN = path.join(T, "gbin");
fs.mkdirSync(GBIN);
fs.writeFileSync(path.join(GBIN, "gh"), `#!${process.execPath}
// stateful fake gh: issues, labels and PRs in $FAKE_GH_DB; every other call goes to tests/fakegh.js
const fs = require("fs"), { spawnSync } = require("child_process");
const argv = process.argv.slice(2), DB = process.env.FAKE_GH_DB;
fs.appendFileSync(DB + ".log", argv.join(" ") + "\\n");
const db = JSON.parse(fs.readFileSync(DB, "utf8"));
const save = () => fs.writeFileSync(DB, JSON.stringify(db));
const all = (k) => argv.flatMap((a, i) => (a === k && argv[i + 1] ? argv[i + 1].split(",") : []));
const out = (o) => { process.stdout.write(JSON.stringify(o)); process.exit(0); };
const [c1, c2, c3] = argv;
if (c1 === "issue" && c2 === "list") {
  const st = (all("--state")[0] || "open").toUpperCase();
  out(db.issues.filter((i) => (st === "ALL" || i.state === st) && all("--label").every((l) => i.labels.some((x) => x.name === l))).map(({ comments, ...i }) => i));
}
const issue = db.issues.find((i) => String(i.number) === String(c3));
if (c1 === "issue" && c2 === "view" && issue) out({ comments: issue.comments.map((body) => ({ body })) });
if (c1 === "issue" && c2 === "edit" && issue) {
  for (const l of all("--add-label")) if (!issue.labels.some((x) => x.name === l)) issue.labels.push({ name: l });
  issue.labels = issue.labels.filter((x) => !all("--remove-label").includes(x.name));
  save(); process.exit(0);
}
if (c1 === "label" && c2 === "create") { if (!db.labels.includes(c3)) db.labels.push(c3); save(); process.exit(0); }
if (c1 === "label" && c2 === "list") out(db.labels.map((name) => ({ name })));
if (c1 === "pr" && c2 === "list") out(db.prs.filter((p) => !all("--base").length || all("--base").includes(p.baseRefName)));
const r = spawnSync(process.execPath, [process.env.FAKE_GH_FALLBACK, ...argv], { stdio: "inherit" });
process.exit(r.status === null ? 1 : r.status);
`, { mode: 0o755 });
const DB = path.join(T, "gh.json");
const iso = (h) => new Date(Date.UTC(2026, 8, 28) + h * 3600e3).toISOString();
const ms = { number: 1, title: `${RUN}/m1` };
fs.writeFileSync(DB, JSON.stringify({
  labels: ["hive", "hive-log", "hive-review", "hive-debt", "hive-question", "needs-human", "profile:backend", "difficulty:standard"],
  issues: [
    { number: 17, title: `Run: ${RUN}`, state: "OPEN", createdAt: iso(0), closedAt: null, milestone: null, labels: [{ name: "hive-log" }], comments: [`decision ${RUN}-1: keep sqlite`, `decision ${RUN}-2: wave 2 dispatched`] },
    { number: 11, title: "t1: api", state: "CLOSED", createdAt: iso(0), closedAt: iso(1), milestone: ms, labels: [{ name: "hive" }, { name: "profile:backend" }], comments: [] },
    { number: 12, title: "t2: store", state: "OPEN", createdAt: iso(1), closedAt: null, milestone: ms, labels: [{ name: "hive" }, { name: "profile:backend" }], comments: [] },
    { number: 13, title: "t3: cli", state: "OPEN", createdAt: iso(1), closedAt: null, milestone: ms, labels: [{ name: "hive" }, { name: "profile:backend" }], comments: [] },
  ],
  prs: [{ number: 40, baseRefName: `hive/${RUN}`, headRefName: `hive/${RUN}-3`, reviews: [], comments: [] }],
}));

// ---- helpers
const envFor = (home, extra = {}) => ({ HOME: home, PATH: [GBIN, lib.BIN, path.dirname(process.execPath), "/usr/bin", "/bin"].join(path.delimiter), FAKE_GH_DB: DB, FAKE_GH_FALLBACK: path.join(lib.BIN, "gh"), ...extra });
const fakeHome = (n) => { const h = path.join(T, `home-${n}`); fs.mkdirSync(path.join(h, ".claude"), { recursive: true }); return h; };
const run = (script, cwd, home, args = [], input = "", extra = {}) => lib.run(script, input, { cwd, env: envFor(home, extra), args });
const read = (...p) => { try { return fs.readFileSync(path.join(...p), "utf8"); } catch { return null; } };
const exists = (...p) => fs.existsSync(path.join(...p));
const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex").slice(0, 12);
const branches = (repo) => g(repo, "for-each-ref", "--format=%(refname:short)", "refs/heads/").split("\n").filter(Boolean);
// the run survives under either name, its evidence branch too
const runKept = (repo) => { const b = branches(repo); return (b.includes(`hive/${RUN}`) || b.includes(`proteus/${RUN}`)) && (b.includes(`hive-evidence/${RUN}`) || b.includes(`proteus-evidence/${RUN}`)); };
const journalAt = (repo) => [".git/proteus/journal.jsonl", ".git/hive/journal.jsonl"].find((f) => read(repo, f) === JOURNAL) || "";
// the autostart's state line lists the run as open, whatever prefix it shows it under
const listsRun = (out) => new RegExp(`(^|\\s)[\\w-]*(branches|runs)=(\\S*[,/])?${RUN}(?=[,\\s]|$)`, "m").test(out);
const stateLine = (out) => (out.split("\n").find((l) => l.startsWith("proteus-state")) || "").slice(0, 400);
const sessionStart = (repo, home, source) => run(path.join(repo, ".claude", "hooks", "proteus-autostart.js"), repo, home, [], { hook_event_name: "SessionStart", source, session_id: `s-${source}`, cwd: repo });
// no background fetch of the checkout, no fast-forward: the autostart only reads it
const quiet = (home) => { const f = path.join(home, ".claude", "proteus.json"); const c = JSON.parse(read(f) || "{}"); fs.writeFileSync(f, JSON.stringify({ ...c, autoUpdate: false, lastFetch: Date.now() })); };
const doctorNames = (out) => /^(FIX|WARN|FAIL)\b.*\.git[\\/]hive\b/m.test(out);

// a repo on the pre-rename names: hive/<run> run with a ticket branch and evidence, .git/hive/ state and journal
function legacyRepo(name, { open = true } = {}) {
  const d = path.join(T, name);
  g(T, "init", "-q", "-b", "main", d);
  fs.writeFileSync(path.join(d, "README.md"), "legacy\n");
  g(d, "add", "-A"); g(d, "commit", "-qm", "init");
  if (open) for (const b of [`hive/${RUN}`, `hive/${RUN}-3`, `hive-evidence/${RUN}`]) g(d, "branch", b);
  const s = path.join(d, ".git", "hive");
  fs.mkdirSync(s, { recursive: true });
  fs.writeFileSync(path.join(s, "journal.jsonl"), JOURNAL);
  fs.writeFileSync(path.join(s, "inbox.json"), JSON.stringify({ at: iso(2), questions: [], reviews: [] }) + "\n");
  g(d, "pack-refs", "--all"); // as git gc leaves them
  return d;
}

// every file in the repo but the index, with its hash: a second --project must leave this unchanged
function snapshot(repo) {
  const rows = [];
  const walk = (d, rel) => {
    for (const e of fs.readdirSync(d).sort()) {
      const p = path.join(d, e), r = rel ? `${rel}/${e}` : e;
      if (r === ".git/index") continue;
      const st = fs.lstatSync(p);
      if (st.isSymbolicLink()) rows.push(`${r} -> ${fs.readlinkSync(p)}`);
      else if (st.isDirectory()) walk(p, r);
      else rows.push(`${r} ${sha(p)}`);
    }
  };
  walk(repo, "");
  return rows;
}

// ---- the Check: install.js --project moves .git/hive into .git/proteus; the autostart lists the open run; twice is a no-op
{
  const A = legacyRepo("check");
  const HA = fakeHome("check");
  let r = run(path.join(SRC, "install.js"), A, HA, ["--project"]);
  ok("check: install.js --project in a repo with .git/hive exits 0", r.code === 0, r.out + r.err);
  ok("check: .git/proteus/journal.jsonl holds the same bytes as the old .git/hive/journal.jsonl", read(A, ".git", "proteus", "journal.jsonl") === JOURNAL, read(A, ".git", "proteus", "journal.jsonl"));
  ok("check: .git/hive is gone", !exists(A, ".git", "hive"), (fs.existsSync(path.join(A, ".git", "hive")) && fs.readdirSync(path.join(A, ".git", "hive")).join(",")) || "");
  quiet(HA);
  const s = sessionStart(A, HA, "startup");
  ok("check: the autostart lists demo as an open run", listsRun(stateLine(s.out)), stateLine(s.out) || s.err);
  const before = snapshot(A);
  r = run(path.join(SRC, "install.js"), A, HA, ["--project"]);
  const after = snapshot(A);
  const diff = [...after.filter((x) => !before.includes(x)).map((x) => `+${x}`), ...before.filter((x) => !after.includes(x)).map((x) => `-${x}`)];
  ok("check: a second --project exits 0 and changes nothing", r.code === 0 && !diff.length, `${r.code} ${diff.slice(0, 6).join(" | ")}`);
  ok("check: the open run and its evidence branch are still there", runKept(A), branches(A).join(","));
}

// ---- auto-update (addendum): an install from main (7d3d544), fast-forwarded by its own autostart, --project never re-run
let LR = "", HB = "", PH = "";
{
  const UB = path.join(T, "upstream.git"), UA = path.join(T, "upstream-work");
  PH = path.join(T, "proteus-checkout");
  g(T, "init", "-q", "--bare", "-b", "main", UB);
  g(T, "clone", "-q", UB, UA);
  const tar = spawnSync("git", ["archive", "--format=tar", OLD_MAIN], { cwd: ROOT, maxBuffer: 1 << 28, windowsHide: true });
  const untar = tar.status === 0 ? spawnSync("tar", ["-x", "-C", UA], { input: tar.stdout, windowsHide: true }) : { status: 1 };
  ok(`auto-update fixture: main at ${OLD_MAIN} is in this checkout's history (CI clones with fetch-depth 0)`, tar.status === 0 && untar.status === 0, String(tar.stderr || ""));
  g(UA, "add", "-A"); g(UA, "commit", "-qm", `chore: main at ${OLD_MAIN}`); g(UA, "push", "-q", "-u", "origin", "HEAD:main");
  g(T, "clone", "-q", UB, PH);
  // this branch, one commit ahead: what the fast-forward lands on
  g(UA, "rm", "-rq", "--", ".");
  for (const f of tracked) {
    const s = path.join(SRC, f);
    if (!fs.existsSync(s)) continue;
    fs.mkdirSync(path.dirname(path.join(UA, f)), { recursive: true });
    fs.copyFileSync(s, path.join(UA, f));
  }
  g(UA, "add", "-A"); g(UA, "commit", "-qm", "feat: this branch"); g(UA, "push", "-q");
  g(PH, "fetch", "-q");

  LR = legacyRepo("autoupdate");
  HB = fakeHome("autoupdate");
  let r = run(path.join(PH, "install.js"), LR, HB, ["--project"]);
  ok(`auto-update fixture: the ${OLD_MAIN} installer sets up the repo`, r.code === 0 && exists(LR, ".claude", "hooks", "proteus-autostart.js"), r.out + r.err);
  const cf = path.join(HB, ".claude", "proteus.json");
  fs.writeFileSync(cf, JSON.stringify({ ...JSON.parse(read(cf) || "{}"), autoUpdate: true, lastFetch: Date.now() }));
  const s1 = sessionStart(LR, HB, "startup");
  ok(`auto-update fixture: the ${OLD_MAIN} autostart saw hive/demo, fast-forwarded the checkout to this branch and synced the hooks`,
    /hive-branches=hive\/demo( |$)/m.test(s1.out) && /proteus: updated to/.test(s1.out) && g(PH, "rev-parse", "HEAD") === g(UA, "rev-parse", "HEAD") &&
    read(LR, ".claude", "hooks", "proteus-lib.js") === read(PH, "templates", "hooks", "proteus-lib.js"), stateLine(s1.out) + s1.err);

  const s2 = sessionStart(LR, HB, "compact");
  const body = (read(PH, "skills", "proteus", "SKILL.md") || "").replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "");
  const said = s2.out.replace(body, "");
  ok("auto-update: the next session start keeps the journal byte for byte (in .git/proteus or .git/hive)", !!journalAt(LR), [read(LR, ".git", "proteus", "journal.jsonl"), read(LR, ".git", "hive", "journal.jsonl")].join(" | "));
  ok("auto-update: the next session start keeps hive/demo open (or renamed to proteus/demo)", runKept(LR), branches(LR).join(","));
  ok("auto-update: the next session start lists demo as an open run, or prints the one command that finishes the move",
    listsRun(stateLine(said)) || /install\.js"? --update\b|install\.ps1"? -Update\b/.test(said), stateLine(said) || said.slice(0, 400));
  ok("auto-update: after a compaction the lead still gets the human's words from the journal", /human said/.test(said) && said.includes(PROMPT), said.slice(0, 600));
}

// ---- 4. orphaned state dir, part 1: after the fast-forward, .git/hive is migrated or --doctor names it
{
  const r = run(path.join(PH, "install.js"), LR, HB, ["--doctor"]);
  ok("orphan (4): after the auto-update, .git/hive is migrated or --doctor reports it (FIX/WARN row naming .git/hive)", !exists(LR, ".git", "hive") || doctorNames(r.out), r.out.split("\n").filter((l) => /hive/.test(l)).join(" | ") || r.out.slice(0, 400));
}

// ---- auto-update, finish: the printed command moves the state
{
  const r = run(path.join(PH, "install.js"), LR, HB, ["--update"]);
  ok("auto-update: install.js --update then moves the journal into .git/proteus, removes .git/hive and keeps the run",
    r.code === 0 && read(LR, ".git", "proteus", "journal.jsonl") === JOURNAL && !exists(LR, ".git", "hive") && runKept(LR), `${r.code} ${r.err.slice(0, 300)}`);
}

// ---- 1. open legacy run: new hooks over legacy state (no --project); autostart, status and the guard serve it
{
  const LC = legacyRepo("legacy-run");
  const HC = fakeHome("legacy-run");
  fs.cpSync(path.join(SRC, "templates", "hooks"), path.join(LC, ".claude", "hooks"), { recursive: true });
  fs.mkdirSync(path.join(LC, ".claude", "skills", "proteus"), { recursive: true });
  fs.writeFileSync(path.join(LC, ".claude", "skills", "proteus", "SKILL.md"), "---\nname: proteus\n---\nSKILL BODY\n");
  const s = sessionStart(LC, HC, "startup");
  ok("legacy run (1): the autostart lists demo as an open run", listsRun(stateLine(s.out)), stateLine(s.out) || s.err);
  ok("legacy run (1): the autostart prints the tail of demo's run log (labelled hive-log)", s.out.includes(`decision ${RUN}-2`), s.out.slice(0, 600));
  const st = run(path.join(LC, ".claude", "hooks", "proteus-status.js"), LC, HC);
  ok("legacy run (1): status reports run demo, not \"no open run\"", new RegExp(`^run ${RUN}\\b`).test(st.out), st.out + st.err);
  ok("legacy run (1): status counts demo's hive-labelled tickets", st.out.includes(`milestone ${RUN}/m1 1/3 closed`), st.out + st.err);
  const edit = { hook_event_name: "PreToolUse", session_id: "s1", cwd: LC, tool_name: "Edit", tool_input: { file_path: path.join(LC, "src", "a.ts") }, agent_id: "a1", agent_type: "proteus-worker" };
  const gd = run(path.join(LC, ".claude", "hooks", "proteus-lead-guard.js"), LC, HC, [], edit);
  ok("legacy run (1): the guard refuses a worker edit in the main checkout while demo is open", gd.code === 2 && /workers edit only inside their worktree/.test(gd.err), `${gd.code} ${gd.err}`);
  const tk = read(SRC, "skills", "proteus", "references", "tracker.md") || "";
  ok("legacy run (1): tracker.md's labels step creates the proteus labels on `labels: created` without `labels: proteus`, then records `labels: proteus`",
    /labels: created/.test(tk) && /labels: proteus/.test(tk), tk.split("\n").find((l) => l.startsWith("| labels")) || "");
  ok("legacy run (1): after the session start the run, its evidence branch and the journal are all still there", runKept(LC) && !!journalAt(LC), branches(LC).join(","));
}

// ---- 2. scratch sweep: scratch of an open run, legacy or new, is never swept; a done run's still is
{
  const LD = legacyRepo("scratch");
  g(LD, "branch", "proteus/new");
  const sd = (k) => path.join(LD, ".git", "proteus", "scratch", k);
  const old = new Date(Date.now() - 4 * 864e5); // done-and-idle-72h territory, under the 7-day cap
  const make = () => {
    for (const k of [RUN, `${RUN}-3`, "new", "gone"]) {
      if (fs.existsSync(sd(k))) continue;
      fs.mkdirSync(sd(k), { recursive: true });
      fs.writeFileSync(path.join(sd(k), "render.bin"), "x".repeat(1024));
      fs.utimesSync(sd(k), old, old);
    }
  };
  const sweep = (arg) => run(path.join(SRC, "templates", "hooks", "proteus-scratch.js"), LD, lib.HOME, ["--sweep", arg]);
  make();
  let r = sweep("--stale");
  ok("scratch (2): --stale keeps demo and demo-3, the open legacy run's and its ticket's", fs.existsSync(sd(RUN)) && fs.existsSync(sd(`${RUN}-3`)), r.out + r.err);
  ok("scratch (2): --stale keeps new, the open proteus run's, and sweeps gone, a done run's", fs.existsSync(sd("new")) && !fs.existsSync(sd("gone")), r.out + r.err);
  make();
  r = sweep("--all-done");
  ok("scratch (2): --all-done keeps demo and demo-3 while hive/demo is open", fs.existsSync(sd(RUN)) && fs.existsSync(sd(`${RUN}-3`)), r.out + r.err);
}

// ---- 3. Codex writable_roots: ../<repo>-hive goes only once no legacy run needs it, and both never stay without a reason
{
  const HE = fakeHome("codex");
  const codexEnv = { CODEX_HOME: path.join(HE, ".codex") };
  const cfg = (repo) => read(repo, ".codex", "config.toml") || "";
  const withHive = (repo) => {
    fs.mkdirSync(path.join(repo, ".codex"), { recursive: true });
    fs.writeFileSync(path.join(repo, ".codex", "config.toml"), `[sandbox_workspace_write]\nwritable_roots = [${JSON.stringify(repo + "-hive")}]\n`);
  };
  // a legacy ticket still in flight: its worktree lives in ../<repo>-hive/
  const L1 = legacyRepo("codex-live");
  g(L1, "worktree", "add", "-q", path.join(`${L1}-hive`, `${RUN}-3`), `hive/${RUN}-3`);
  withHive(L1);
  let r = run(path.join(SRC, "install.js"), L1, HE, ["--project", "--harness", "codex"], "", codexEnv);
  const d1 = run(path.join(SRC, "install.js"), L1, HE, ["--doctor", "--harness", "codex"], "", codexEnv);
  ok("codex (3): with a legacy worktree in <repo>-hive, config.toml keeps that root beside <repo>-proteus",
    r.code === 0 && cfg(L1).includes(JSON.stringify(`${L1}-hive`)) && cfg(L1).includes(JSON.stringify(`${L1}-proteus`)), `${r.code} ${cfg(L1)} ${r.err.slice(0, 200)}`);
  ok("codex (3): the kept <repo>-hive root has its reason in the --project or --doctor output", (r.out + d1.out).includes(`${L1}-hive`), (r.out + d1.out).split("\n").filter((l) => /sandbox|writable|hive/.test(l)).join(" | "));
  // no legacy run left: the stale entry goes
  const L2 = legacyRepo("codex-done", { open: false });
  withHive(L2);
  r = run(path.join(SRC, "install.js"), L2, HE, ["--project", "--harness", "codex"], "", codexEnv);
  ok("codex (3): with no legacy run, --project drops the stale <repo>-hive root and lists <repo>-proteus",
    r.code === 0 && !cfg(L2).includes(`${L2}-hive`) && cfg(L2).includes(JSON.stringify(`${L2}-proteus`)), `${r.code} ${cfg(L2)}`);
}

// ---- 4. orphaned state dir, part 2: a file already in .git/proteus is never overwritten, and what stays is reported
{
  const LF = legacyRepo("orphan-conflict");
  const HF = fakeHome("orphan");
  fs.mkdirSync(path.join(LF, ".git", "proteus"), { recursive: true });
  fs.writeFileSync(path.join(LF, ".git", "proteus", "lead-model.json"), "{\"model\":\"mine\"}\n");
  fs.writeFileSync(path.join(LF, ".git", "hive", "lead-model.json"), "{\"model\":\"old\"}\n");
  const r = run(path.join(SRC, "install.js"), LF, HF, ["--project"]);
  const d = run(path.join(SRC, "install.js"), LF, HF, ["--doctor"]);
  ok("orphan (4): --project never overwrites a file already in .git/proteus", r.code === 0 && read(LF, ".git", "proteus", "lead-model.json") === "{\"model\":\"mine\"}\n", read(LF, ".git", "proteus", "lead-model.json"));
  ok("orphan (4): the journal moves beside it, byte for byte", read(LF, ".git", "proteus", "journal.jsonl") === JOURNAL, read(LF, ".git", "proteus", "journal.jsonl"));
  ok("orphan (4): a .git/hive left behind by the conflict is reported by --doctor, never silently kept", !exists(LF, ".git", "hive") || doctorNames(d.out), d.out.split("\n").filter((l) => /hive/.test(l)).join(" | ") || d.out.slice(0, 300));
}

summary();
if (!process.exitCode) fs.rmSync(T, { recursive: true, force: true });
else console.log(`fixtures kept in ${T}`);
