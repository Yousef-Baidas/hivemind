// hivemind hooks and installer tests: node tests/hooks.test.js (Linux or macOS, needs git).
// Temp HOME, temp repos, fake gh; never touches ~/.claude or the network.
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync, execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "templates", "hooks");
const W = path.join(os.tmpdir(), "hivemind-test");
fs.rmSync(W, { recursive: true, force: true });
fs.mkdirSync(W, { recursive: true });
const HOME = path.join(W, "home");
const BIN = path.join(W, "bin");
fs.mkdirSync(path.join(HOME, ".claude"), { recursive: true });
fs.mkdirSync(BIN);
fs.copyFileSync(path.join(__dirname, "fakegh.js"), path.join(BIN, "gh"));
fs.chmodSync(path.join(BIN, "gh"), 0o755);
const ENV = { PATH: `${BIN}:/usr/bin:/bin`, HOME, GIT_CONFIG_GLOBAL: "/dev/null", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
const g = (cwd, ...args) => execFileSync("git", args, { cwd, env: ENV, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

let pass = 0, fail = 0;
const timings = {};
function ok(name, cond, extra) {
  if (cond) pass++; else { fail++; console.log(`FAIL ${name}${extra ? " :: " + String(extra).slice(0, 600) : ""}`); }
}
function run(script, input, { cwd = REPO, env = {}, args = [] } = {}) {
  const t = process.hrtime.bigint();
  const r = spawnSync(process.execPath, [script, ...args], { cwd, input: typeof input === "string" ? input : JSON.stringify(input || {}), env: { ...ENV, CLAUDE_PROJECT_DIR: cwd, ...env }, encoding: "utf8" });
  const ms = Number(process.hrtime.bigint() - t) / 1e6;
  const k = path.basename(script);
  (timings[k] = timings[k] || []).push(ms);
  return { code: r.status, out: r.stdout, err: r.stderr, ms };
}

// ---- hivemind source checkout with an upstream (local bare repo, no network)
const BARE = path.join(W, "remote.git");
const HSRC = path.join(W, "hivesrc");
g(W, "init", "-q", "--bare", "-b", "main", BARE);
g(W, "clone", "-q", BARE, HSRC);
fs.mkdirSync(path.join(HSRC, "agents"));
fs.writeFileSync(path.join(HSRC, "agents", "hive-worker.md"), "worker v1\n");
fs.mkdirSync(path.join(HSRC, "templates"), { recursive: true });
fs.cpSync(SRC, path.join(HSRC, "templates", "hooks"), { recursive: true });
g(HSRC, "add", "-A"); g(HSRC, "commit", "-qm", "init"); g(HSRC, "push", "-q", "-u", "origin", "HEAD:main");
const OTHER = path.join(W, "other");
g(W, "clone", "-q", BARE, OTHER);
fs.writeFileSync(path.join(OTHER, "agents", "hive-worker.md"), "worker v2\n");
g(OTHER, "commit", "-qam", "v2"); g(OTHER, "push", "-q");
g(HSRC, "fetch", "-q"); // HSRC is now 1 behind @{u}

// ---- target repo, lead hooks installed from the hivemind checkout
const REPO = path.join(W, "repo");
fs.mkdirSync(REPO);
g(REPO, "init", "-q", "-b", "main");
fs.mkdirSync(path.join(REPO, ".claude", "skills", "hivemind"), { recursive: true });
fs.writeFileSync(path.join(REPO, ".claude", "skills", "hivemind", "SKILL.md"), "---\nname: hivemind\n---\nSKILL BODY\n");
fs.writeFileSync(path.join(REPO, "CLAUDE.md"), "x\n".repeat(200));
fs.writeFileSync(path.join(REPO, "CLAUDE-extra.md"), "y\n");
fs.writeFileSync(path.join(REPO, "AGENTS.md"), "## Learned\n");
fs.writeFileSync(path.join(REPO, "README.md"), "r\n");
g(REPO, "add", "-A"); g(REPO, "commit", "-qm", "init");
g(REPO, "branch", "hive/bl1077"); g(REPO, "branch", "hive/bl1077-4"); g(REPO, "branch", "hive/bl1077-6");
const H = path.join(REPO, ".claude", "hooks");
const hook = (f) => path.join(H, f);

// install-lead-hooks: fresh, idempotent, old-matcher upgrade, invalid JSON, statusLine only when absent
const SET = path.join(REPO, ".claude", "settings.local.json");
fs.writeFileSync(SET, JSON.stringify({ permissions: { allow: ["Bash(ls)"] }, hooks: { PreToolUse: [
  { matcher: "Edit|Write|MultiEdit|NotebookEdit|Agent|Task", hooks: [{ type: "command", command: 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/hive-lead-guard.js"' }] },
  { matcher: "Bash", hooks: [{ type: "command", command: "my-own-hook" }] }] } }, null, 2));
let r = run(path.join(SRC, "install-lead-hooks.js"), "", { cwd: REPO });
ok("install exit 0", r.code === 0, r.err);
const s1 = fs.readFileSync(SET, "utf8");
const j1 = JSON.parse(s1);
ok("install upgrades old guard matcher", j1.hooks.PreToolUse[0].matcher === "Edit|Write|MultiEdit|NotebookEdit|Agent|Task|Bash|Monitor|Read", JSON.stringify(j1.hooks.PreToolUse[0]));
ok("install keeps user hook + permissions", s1.includes("my-own-hook") && j1.permissions.allow[0] === "Bash(ls)");
ok("install registers all events", ["SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "SubagentStop", "TeammateIdle"].every((e) => j1.hooks[e] && j1.hooks[e].length));
ok("install one guard entry", j1.hooks.PreToolUse.filter((e) => JSON.stringify(e).includes("hive-lead-guard")).length === 1);
ok("install statusLine absolute", j1.statusLine && j1.statusLine.command === `node "${H}/hive-statusline.js"`, JSON.stringify(j1.statusLine));
ok("install copies all but itself", fs.readdirSync(SRC).filter((f) => f !== "install-lead-hooks.js").every((f) => fs.existsSync(hook(f))) && !fs.existsSync(hook("install-lead-hooks.js")));
r = run(path.join(SRC, "install-lead-hooks.js"), "", { cwd: REPO });
ok("install idempotent", fs.readFileSync(SET, "utf8") === s1 && r.code === 0);
console.log("install line: " + r.out.trim());
const REPO2 = path.join(W, "repo2"); fs.mkdirSync(path.join(REPO2, ".claude"), { recursive: true });
fs.writeFileSync(path.join(REPO2, ".claude", "settings.local.json"), "{ bad json");
r = run(path.join(SRC, "install-lead-hooks.js"), "", { cwd: REPO2 });
ok("install invalid json → exit 1, untouched", r.code === 1 && fs.readFileSync(path.join(REPO2, ".claude", "settings.local.json"), "utf8") === "{ bad json", r.err);
fs.writeFileSync(path.join(REPO2, ".claude", "settings.local.json"), JSON.stringify({ statusLine: { type: "command", command: "mine" } }));
run(path.join(SRC, "install-lead-hooks.js"), "", { cwd: REPO2 });
ok("install keeps existing statusLine", JSON.parse(fs.readFileSync(path.join(REPO2, ".claude", "settings.local.json"), "utf8")).statusLine.command === "mine");
fs.writeFileSync(path.join(REPO2, ".claude", "settings.local.json"), JSON.stringify({ statusLine: { type: "command", command: "mine" }, hooks: { PreToolUse: [{ matcher: "Edit|Write|MultiEdit|NotebookEdit|Agent|Task|Bash|Monitor", hooks: [{ type: "command", command: 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/hive-lead-guard.js"' }] }] } }));
run(path.join(SRC, "install-lead-hooks.js"), "", { cwd: REPO2 });
ok("install upgrades previous matcher (adds Read)", JSON.parse(fs.readFileSync(path.join(REPO2, ".claude", "settings.local.json"), "utf8")).hooks.PreToolUse.filter((e) => JSON.stringify(e).includes("hive-lead-guard")).map((e) => e.matcher).join() === "Edit|Write|MultiEdit|NotebookEdit|Agent|Task|Bash|Monitor|Read");
const REPO3 = path.join(W, "repo3"); fs.mkdirSync(REPO3);
r = run(path.join(SRC, "install-lead-hooks.js"), "", { cwd: REPO3 });
ok("install missing settings", r.code === 0 && fs.existsSync(path.join(REPO3, ".claude", "settings.local.json")));

// ---- synthetic transcripts
const T = path.join(W, "t"); fs.mkdirSync(T);
const asst = (n, text = "ok", side = false) => JSON.stringify({ type: "assistant", isSidechain: side, message: { role: "assistant", content: [{ type: "text", text }], usage: { input_tokens: 2, cache_read_input_tokens: n - 1002, cache_creation_input_tokens: 1000, output_tokens: 50 } } });
const pad = JSON.stringify({ type: "user", message: { role: "user", content: "p".repeat(5000) } });
const tr = (name, lines) => { const f = path.join(T, name); fs.writeFileSync(f, lines.join("\n") + "\n"); return f; };
const T100 = tr("100k.jsonl", [asst(100000)]);
const T160 = tr("160k.jsonl", [asst(50000), ...Array(80).fill(pad), asst(160000), pad]);
const T190 = tr("190k.jsonl", [asst(190000), asst(999999, "side", true)]);
const TCOMP = tr("comp.jsonl", [asst(190000), JSON.stringify({ type: "system", subtype: "compact_boundary", compactMetadata: { postTokens: 21000 } })]);
// big file: usage beyond the 256 KB tail is not seen (meter reads tail only)
const TBIG = tr("big.jsonl", [asst(170000), ...Array(300).fill(pad), asst(120000)]);

// ---- lead guard
const LG = hook("hive-lead-guard.js");
const pre = (tool, ti, extra = {}) => ({ hook_event_name: "PreToolUse", session_id: "s1", transcript_path: T100, cwd: REPO, tool_name: tool, tool_input: ti, ...extra });
const code = (inp, opts) => run(LG, inp, opts).code;
ok("guard: lead edit src denied", code(pre("Edit", { file_path: path.join(REPO, "src/a.ts") })) === 2);
ok("guard: lead AGENTS.md allowed", code(pre("Write", { file_path: path.join(REPO, "AGENTS.md") })) === 0);
ok("guard: lead docs/lessons allowed", code(pre("Write", { file_path: "docs/lessons/x.md" })) === 0);
ok("guard: lead docs/adr allowed", code(pre("Write", { file_path: "docs/adr/0001-x.md" })) === 0);
ok("guard: lead outside repo allowed", code(pre("Write", { file_path: "/tmp/issue-body.md" })) === 0);
ok("guard: haiku denied", code(pre("Agent", { model: "haiku", subagent_type: "hive-worker", prompt: "x" })) === 2);
ok("guard: sonnet allowed", code(pre("Agent", { model: "sonnet", subagent_type: "general-purpose", prompt: "x" })) === 0);
ok("guard: no-model non-hive denied", code(pre("Agent", { subagent_type: "general-purpose" })) === 2);
ok("guard: --edit-last denied (lead)", code(pre("Bash", { command: "gh issue comment 7 --edit-last --body x" })) === 2);
ok("guard: lead run_in_background allowed", code(pre("Bash", { command: "sleep 99", run_in_background: true })) === 0);
ok("guard: lead Monitor allowed", code(pre("Monitor", { command: "x" })) === 0);
const sub = { agent_id: "a1", agent_type: "hive-worker" };
r = run(LG, pre("Bash", { command: "npm run render", run_in_background: true }, sub));
ok("guard: subagent run_in_background denied", r.code === 2 && /never wait on a background notification/.test(r.err), r.err);
ok("guard: subagent Monitor denied", code(pre("Monitor", { command: "x" }, sub)) === 2);
ok("guard: subagent --edit-last denied", code(pre("Bash", { command: "gh pr comment 3 --edit-last -b y" }, sub)) === 2);
ok("guard: subagent foreground Bash allowed", code(pre("Bash", { command: "npm test" }, sub)) === 0);
r = run(LG, pre("Edit", { file_path: path.join(REPO, "src/a.ts") }, sub));
ok("guard: subagent edit main checkout during run denied", r.code === 2 && /workers edit only inside their worktree \(none found from your cwd; comment NEEDS on the issue and stop\)\. src\/a\.ts is in the main checkout/.test(r.err), r.err);
r = run(LG, pre("Agent", { model: "opus", subagent_type: "hive-worker" }, { transcript_path: T190 }));
ok("guard: context 190k blocks spawn", r.code === 2 && /context at 190k/.test(r.err), r.err);
ok("guard: context after compaction ok", code(pre("Agent", { model: "opus", subagent_type: "hive-worker" }, { transcript_path: TCOMP })) === 0);
ok("guard: HIVE_HANDOFF_HARD env", run(LG, pre("Agent", { model: "opus", subagent_type: "hive-worker" }), { env: { HIVE_HANDOFF_HARD: "90000" } }).code === 2);
// model ladder: the lead's model from the transcript's newest main-thread reply
const withModel = (m, sideModel) => tr(`m-${m}.jsonl`, [JSON.stringify({ type: "assistant", message: { role: "assistant", model: m, content: [{ type: "text", text: "x" }], usage: { input_tokens: 10 } } }),
  ...(sideModel ? [JSON.stringify({ type: "assistant", isSidechain: true, message: { role: "assistant", model: sideModel, content: [], usage: { input_tokens: 5 } } })] : [])]);
const spawn = (model, tp, opts) => run(LG, pre("Agent", { ...(model ? { model } : {}), subagent_type: "hive-worker", prompt: "x" }, { transcript_path: tp }), opts);
{
  const TF = withModel("claude-fable-5-1", "claude-sonnet-5-5"), TO = withModel("claude-opus-5-5[1m]"), TS = withModel("claude-sonnet-5-5"), TH = withModel("claude-haiku-4-5-20251001");
  r = spawn("", T100);
  ok("ladder: missing model denied, hive agents too", r.code === 2 && /every Agent call names its model/.test(r.err) && /use "opus" for hard tickets and every verdict, "sonnet" for standard/.test(r.err), r.err);
  ok("ladder: unknown lead → opus and sonnet ok", spawn("opus", T100).code === 0 && spawn("sonnet", T100).code === 0);
  r = spawn("haiku", T100);
  ok("ladder: haiku under the floor", r.code === 2 && /under the floor \(sonnet\)/.test(r.err), r.err);
  r = spawn("fable", TF);
  ok("ladder: fable lead, fable worker denied as once per project", r.code === 2 && /fable runs once per project and the lead is it/.test(r.err) && /models: solo=none/.test(r.err), r.err);
  ok("ladder: fable lead (sidechain reply ignored) → opus ok", spawn("opus", TF).code === 0);
  ok("ladder: opus lead → opus worker ok, fable denied", spawn("opus", TO).code === 0 && spawn("fable", TO).code === 2);
  r = spawn("opus", TS);
  ok("ladder: sonnet lead → opus above the lead", r.code === 2 && /above the lead \(claude-sonnet-5-5\); nothing above sonnet/.test(r.err) && /use "sonnet" for hard tickets and every verdict, "sonnet" for standard/.test(r.err), r.err);
  ok("ladder: sonnet lead → sonnet ok", spawn("sonnet", TS).code === 0);
  ok("ladder: haiku lead takes the floor down → haiku ok, sonnet denied", spawn("haiku", TH).code === 0 && spawn("sonnet", TH).code === 2);
  r = spawn("gpt-6", TO);
  ok("ladder: model not on the ladder", r.code === 2 && /not on the ladder \(haiku < sonnet < opus < fable\)/.test(r.err), r.err);
  const AG = path.join(REPO, "AGENTS.md"), agBefore = fs.readFileSync(AG, "utf8");
  fs.writeFileSync(AG, agBefore + "models: solo=none floor=haiku\n");
  ok("ladder: AGENTS.md models: line lifts solo and floor", spawn("fable", TF).code === 0 && spawn("haiku", TO).code === 0);
  fs.writeFileSync(AG, agBefore);
  const MH = path.join(W, "ladder-home"); fs.mkdirSync(path.join(MH, ".claude"), { recursive: true });
  fs.writeFileSync(path.join(MH, ".claude", "hivemind.json"), JSON.stringify({ models: { ladder: ["sonnet", "opus", "fable"], floor: "sonnet", solo: [] } }));
  ok("ladder: machine config replaces ladder and solo", spawn("fable", TF, { env: { HOME: MH } }).code === 0 && /not on the ladder \(sonnet < opus < fable\)/.test(spawn("haiku", TF, { env: { HOME: MH } }).err));
}
// image reads: lead denied unless the human's latest prompt names the file
const hu = (text, extra = {}) => JSON.stringify({ type: "user", message: { role: "user", content: text }, ...extra });
const TIMG = tr("img.jsonl", [hu("check render_0042.png please", { origin: { kind: "human" }, promptSource: "typed" }), asst(5000),
  JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "tool_result", content: "shot_7.png" }] }, toolUseResult: {} }),
  hu("<task-notification>render_0099.png done</task-notification>", { origin: { kind: "task-notification" } }), asst(6000)]);
const TOLD = tr("img-old.jsonl", [hu("look at Shot_7.JPG"), asst(5000), hu("<task-notification>x.png</task-notification>")]);
const imgDenied = (res) => { try { const h = JSON.parse(res.out).hookSpecificOutput; return res.code === 0 && h.permissionDecision === "deny" && /the lead does not open images .*HIVEMIND=0 claude skips this guard\.$/.test(h.permissionDecisionReason); } catch { return false; } };
r = run(LG, pre("Read", { file_path: path.join(REPO, "renders/render_0001.png") }, { transcript_path: TIMG }));
ok("guard: lead image read denied", imgDenied(r) && r.out.includes(`Read ${path.join(REPO, "renders/render_0001.png")}; answer in 5 lines`), r.out + r.err);
ok("guard: image deny case-insensitive + outside repo", imgDenied(run(LG, pre("Read", { file_path: "/tmp/out/FRAME.EXR" }, { transcript_path: TIMG }))));
ok("guard: image named by human allowed", run(LG, pre("Read", { file_path: path.join(REPO, "renders/render_0042.png") }, { transcript_path: TIMG })).out === "");
ok("guard: name from task-notification/tool result not counted", imgDenied(run(LG, pre("Read", { file_path: "/r/render_0099.png" }, { transcript_path: TIMG }))) && imgDenied(run(LG, pre("Read", { file_path: "/r/shot_7.png" }, { transcript_path: TIMG }))));
ok("guard: older transcript without origin", run(LG, pre("Read", { file_path: "/r/Shot_7.JPG" }, { transcript_path: TOLD })).out === "" && imgDenied(run(LG, pre("Read", { file_path: "/r/x.png" }, { transcript_path: TOLD }))));
const bigImg = JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "tool_result", content: [{ type: "image", source: { data: "A".repeat(400000) } }] }] }, toolUseResult: {} });
const TBIGIMG = tr("bigimg.jsonl", [hu("compare hero_final.png to the brief", { origin: { kind: "human" } }), bigImg, asst(9000), bigImg, asst(9500)]);
ok("guard: named image found past 800 KB of image results", run(LG, pre("Read", { file_path: "/r/hero_final.png" }, { transcript_path: TBIGIMG })).out === "");
ok("guard: prompt before compaction does not count", imgDenied(run(LG, pre("Read", { file_path: "/r/hero_final.png" }, { transcript_path: tr("imgcomp.jsonl", [hu("see hero_final.png", { origin: { kind: "human" } }), JSON.stringify({ type: "system", subtype: "compact_boundary" })]) }))));
ok("guard: image no transcript denied", imgDenied(run(LG, pre("Read", { file_path: "a.webp" }, { transcript_path: undefined }))));
ok("guard: image garbage transcript denied", imgDenied(run(LG, pre("Read", { file_path: "a.hdr" }, { transcript_path: tr("junk.jsonl", ["{not json", "[]", "null"]) }))));
ok("guard: lead non-image Read allowed", run(LG, pre("Read", { file_path: path.join(REPO, "src/a.ts") })).out === "");
ok("guard: subagent image read allowed", run(LG, pre("Read", { file_path: "/r/render_0001.png" }, sub)).out === "");
ok("guard: HIVEMIND=0 passes", run(LG, pre("Edit", { file_path: "src/a.ts" }), { env: { HIVEMIND: "0" } }).code === 0);
ok("guard: garbage stdin passes", run(LG, "not json").code === 0);

// ---- worktree script + worker hooks
const WT = path.join(W, "wt1");
g(REPO, "worktree", "add", "-q", "-b", "hive/bl1077-5", WT);
r = run(hook("hive-worktree.js"), "", { args: [WT, "src/lighting/", "tests/lighting.test.ts"] });
ok("worktree script output", r.code === 0 && r.out.trim() === `worktree ${WT}: hooks + 2 owned paths`, r.out + r.err);
ok("worktree files", ["hive-lib.js", "hive-owned-paths.js", "hive-worker-guard.js", "hive-stall.js", "hive-lessons.js"].every((f) => fs.existsSync(path.join(WT, ".claude", "hooks", f))) &&
  fs.readFileSync(path.join(WT, ".claude", "hive-owned"), "utf8") === "src/lighting/\ntests/lighting.test.ts\n" &&
  JSON.parse(fs.readFileSync(path.join(WT, ".claude", "settings.local.json"), "utf8")).hooks.Stop.length === 1);
ok("worktree untracked files excluded", g(WT, "status", "--porcelain") === "", g(WT, "status", "--porcelain"));
run(hook("hive-worktree.js"), "", { args: [WT, "src/lighting/", "tests/lighting.test.ts"] });
ok("worktree exclude not duplicated", (fs.readFileSync(path.join(REPO, ".git", "info", "exclude"), "utf8").match(/hive-owned/g) || []).length === 1);
ok("worktree usage error", run(hook("hive-worktree.js"), "", { args: [WT] }).code === 1);
const WH = (f) => path.join(WT, ".claude", "hooks", f);
const wpre = (tool, ti) => ({ hook_event_name: "PreToolUse", session_id: "w1", cwd: WT, tool_name: tool, tool_input: ti });
ok("guard: worker worktree image read allowed", run(LG, { ...wpre("Read", { file_path: path.join(WT, "renders/a.png") }), transcript_path: TIMG }, { cwd: WT }).out === "");
// subagent owned paths enforced by the lead guard (worktree hooks may not load in-process)
const sp = (tool, ti, extra = {}) => pre(tool, ti, { ...sub, cwd: WT, ...extra });
ok("guard sub: owned path in worktree allowed", run(LG, sp("Edit", { file_path: path.join(WT, "src/lighting/a.ts") })).code === 0);
r = run(LG, sp("Write", { file_path: path.join(WT, "src/other.ts") }));
ok("guard sub: non-owned path denied with NEEDS", r.code === 2 && r.err.trim() === 'hivemind: src/other.ts is not in .claude/hive-owned. Comment "NEEDS src/other.ts: <why>" on the issue and stop.', r.err);
ok("guard sub: relative owned path (cwd worktree) allowed", run(LG, sp("Edit", { file_path: "src/lighting/b.ts" })).code === 0);
ok("guard sub: exact owned file + NotebookEdit", run(LG, sp("NotebookEdit", { notebook_path: "tests/lighting.test.ts" })).code === 0 && run(LG, sp("MultiEdit", { file_path: "tests/other.test.ts" })).code === 2);
r = run(LG, sp("Edit", { file_path: "src/lighting/../other.ts" }));
ok("guard sub: .. inside worktree normalised", r.code === 2 && /NEEDS src\/other\.ts/.test(r.err), r.err);
r = run(LG, sp("Edit", { file_path: "../repo/src/x.ts" }));
ok("guard sub: .. escape into main checkout denied with worktree hint", r.code === 2 && r.err.includes(`yours is ${WT}: edit ${path.join(WT, "src/x.ts")}`), r.err);
ok("guard sub: outside any repo allowed", run(LG, sp("Write", { file_path: path.join(W, "scratch.txt") })).code === 0);
ok("guard sub: scout skills.txt allowed, other file denied", run(LG, pre("Write", { file_path: "teams/backend/skills.txt" }, { agent_id: "sc", agent_type: "hive-scout" })).code === 0 &&
  run(LG, pre("Write", { file_path: "teams/backend/PROFILE.md" }, { agent_id: "sc", agent_type: "hive-scout" })).code === 2);
ok("guard sub: Read and Bash not path-checked", run(LG, sp("Read", { file_path: path.join(REPO, "src/a.ts") })).code === 0);
ok("guard main thread: worktree path is outside the lead's repo, allowed", run(LG, pre("Edit", { file_path: path.join(WT, "src/other.ts") })).code === 0);
ok("guard main thread: lead rules unchanged", run(LG, pre("Edit", { file_path: path.join(REPO, "src/x.ts") })).code === 2 && run(LG, pre("Edit", { file_path: path.join(REPO, "AGENTS.md") })).code === 0);
const REPO4 = path.join(W, "repo4"); fs.mkdirSync(REPO4); g(REPO4, "init", "-q", "-b", "main");
ok("guard sub: main checkout with no run allowed", run(LG, pre("Edit", { file_path: "src/a.ts" }, { ...sub, cwd: REPO4 }), { cwd: REPO4 }).code === 0);
fs.writeFileSync(path.join(REPO4, ".git", "packed-refs"), "# pack-refs with: peeled fully-peeled sorted\n0123456789abcdef0123456789abcdef01234567 refs/heads/hive/run9\n");
ok("guard sub: packed hive/* ref counts as a run", run(LG, pre("Edit", { file_path: "src/a.ts" }, { ...sub, cwd: REPO4 }), { cwd: REPO4 }).code === 2);
// Windows semantics, in-process: path swapped to win32, a list file named with backslashes in a temp cwd
const WIN = path.join(W, "win"); fs.mkdirSync(WIN);
fs.writeFileSync(path.join(WIN, "C:\\wt\\.claude\\hive-owned"), "src/lighting/\r\ntests\\lighting.test.ts\r\n");
const winJs = path.join(W, "win.js");
fs.writeFileSync(winJs, `const lib = require(${JSON.stringify(path.join(H, "hive-lib.js"))}); process.chdir(${JSON.stringify(WIN)});
const p = require("path"); Object.assign(p, p.win32); Object.defineProperty(process, "platform", { value: "win32" });
console.log(JSON.stringify([lib.ownedDenial("C:\\\\wt", "C:\\\\wt\\\\src\\\\lighting\\\\a.ts"), lib.ownedDenial("C:\\\\wt", "c:\\\\WT\\\\SRC\\\\Lighting\\\\a.ts"),
  lib.ownedDenial("C:\\\\wt", "tests\\\\lighting.test.ts"), lib.ownedDenial("C:\\\\wt", "D:\\\\wt\\\\src\\\\lighting\\\\a.ts"),
  lib.ownedDenial("C:\\\\wt", "..\\\\x.ts"), lib.relPath("C:\\\\wt", "D:\\\\x.ts"), lib.relPath("C:\\\\wt", "C:\\\\wt\\\\..foo")]));`);
const wr = JSON.parse(spawnSync(process.execPath, [winJs], { encoding: "utf8" }).stdout || "null") || [];
ok("win: owned allowed, case-insensitive, backslash glob", wr[0] === "" && wr[1] === "" && wr[2] === "", JSON.stringify(wr));
ok("win: other drive + ..\\ escape denied, relPath cross-drive null, ..foo inside", /^D:\/wt\/src\/lighting\/a\.ts is outside the worktree/.test(wr[3]) && /^\.\.\/x\.ts is outside/.test(wr[4]) && wr[5] === null && wr[6] === "..foo", JSON.stringify(wr));
ok("worker guard: bg denied", run(WH("hive-worker-guard.js"), wpre("Bash", { command: "x", run_in_background: true }), { cwd: WT }).code === 2);
ok("worker guard: Monitor denied", run(WH("hive-worker-guard.js"), wpre("Monitor", {}), { cwd: WT }).code === 2);
ok("worker guard: fg allowed", run(WH("hive-worker-guard.js"), wpre("Bash", { command: "npm test" }), { cwd: WT }).code === 0);
ok("worker guard: inactive without hive-owned", run(hook("hive-worker-guard.js"), wpre("Monitor", {}), { cwd: REPO }).code === 0);
ok("owned: inside allowed", run(WH("hive-owned-paths.js"), wpre("Edit", { file_path: path.join(WT, "src/lighting/a/b.ts") }), { cwd: WT }).code === 0);
ok("owned: exact file allowed", run(WH("hive-owned-paths.js"), wpre("Write", { file_path: "tests/lighting.test.ts" }), { cwd: WT }).code === 0);
r = run(WH("hive-owned-paths.js"), wpre("Edit", { file_path: path.join(WT, "src/other.ts") }), { cwd: WT });
ok("owned: outside denied", r.code === 2 && /NEEDS src\/other.ts/.test(r.err), r.err);
ok("owned: outside worktree denied", run(WH("hive-owned-paths.js"), wpre("Edit", { file_path: "/etc/x" }), { cwd: WT }).code === 2);
ok("owned: ..foo file is inside", run(WH("hive-owned-paths.js"), wpre("Edit", { file_path: "..foo" }), { cwd: WT }).code === 2 && /not in/.test(run(WH("hive-owned-paths.js"), wpre("Edit", { file_path: "..foo" }), { cwd: WT }).err));

// ---- lessons
const LD = path.join(REPO, "docs", "lessons"); fs.mkdirSync(LD, { recursive: true });
fs.writeFileSync(path.join(LD, "npm-build.md"), "---\ntrigger: npm (run )?build\non: command\nscope: all\n---\nSymptom: build OOM.\nFix: NODE_OPTIONS=--max-old-space-size=8192.\n");
fs.writeFileSync(path.join(LD, "bad.md"), "---\ntrigger: ([unclosed\non: command\n---\nbad\n");
fs.writeFileSync(path.join(LD, "enospc.md"), "---\ntrigger: ENOSPC|no space left\non: output\n---\nDisk full: clear /tmp/renders.\n");
fs.writeFileSync(path.join(LD, "lead-only.md"), "---\ntrigger: \"release\"\non: prompt, command\nscope: lead\n---\nLead: releases need the human.\n");
fs.writeFileSync(path.join(LD, "paths.md"), "---\ntrigger: ^src/lighting/\non: path\nscope: worker\n---\nLighting uses linear colour space.\n");
fs.writeFileSync(path.join(LD, "README.md"), "no frontmatter\n");
const LS = hook("hive-lessons.js");
const ctxOf = (res) => { try { return JSON.parse(res.out).hookSpecificOutput.additionalContext; } catch { return ""; } };
r = run(LS, pre("Bash", { command: "npm run build" }));
ok("lessons: command match", /npm-build\.md/.test(ctxOf(r)) && /max-old-space/.test(ctxOf(r)) && JSON.parse(r.out).hookSpecificOutput.hookEventName === "PreToolUse", r.out + r.err);
ok("lessons: deduped in session", run(LS, pre("Bash", { command: "npm build" })).out === "");
ok("lessons: new session sees it", /npm-build/.test(ctxOf(run(LS, pre("Bash", { command: "npm build" }, { session_id: "s2" })))));
ok("lessons: subagent has own seen-set", /npm-build/.test(ctxOf(run(LS, pre("Bash", { command: "npm build" }, sub)))));
r = run(LS, { hook_event_name: "PostToolUse", session_id: "s1", cwd: REPO, tool_name: "Bash", tool_input: { command: "x" }, tool_response: { stdout: "ok", stderr: "write failed: ENOSPC", interrupted: false } });
ok("lessons: output match", /enospc\.md/.test(ctxOf(r)) && JSON.parse(r.out).hookSpecificOutput.hookEventName === "PostToolUse", r.out + r.err);
r = run(LS, { hook_event_name: "UserPromptSubmit", session_id: "s1", cwd: REPO, prompt: "cut the release now" });
ok("lessons: prompt match lead scope", /lead-only/.test(ctxOf(r)), r.out + r.err);
ok("lessons: lead scope hidden from worker", run(LS, pre("Bash", { command: "release" }, { ...sub, session_id: "s9" })).out === "");
ok("lessons: worker path scope (worktree)", /paths\.md/.test(ctxOf(run(WH("hive-lessons.js"), wpre("Edit", { file_path: path.join(WT, "src/lighting/x.ts") }), { cwd: WT }))));
ok("lessons: worker path hidden from lead", run(LS, pre("Read", { file_path: path.join(REPO, "src/lighting/x.ts") }, { session_id: "s3" })).out === "");
const hits = JSON.parse(fs.readFileSync(path.join(REPO, ".git", "hive", "lesson-hits.json"), "utf8"));
ok("lessons: hits recorded", hits["npm-build.md"].hits === 3 && hits["enospc.md"].hits === 1, JSON.stringify(hits));
ok("lessons: cache written", JSON.parse(fs.readFileSync(path.join(REPO, ".git", "hive", "lessons-cache.json"), "utf8")).lessons.length === 5);
for (let i = 0; i < 3; i++) fs.writeFileSync(path.join(LD, `many${i}.md`), `---\ntrigger: deploy\n---\nmany ${i}\n`);
r = run(LS, pre("Bash", { command: "deploy" }, { session_id: "s4" }));
ok("lessons: max 2 per event, cache invalidated", (ctxOf(r).match(/hive lesson/g) || []).length === 2, r.out);
ok("lessons: third arrives next event", /many2/.test(ctxOf(run(LS, pre("Bash", { command: "deploy" }, { session_id: "s4" })))));
ok("lessons: no match no output", run(LS, pre("Bash", { command: "ls" }, { session_id: "s5" })).out === "");

ok("lessons: hits stored as plain hits/last", JSON.stringify(Object.keys(hits["npm-build.md"])) === '["hits","last"]', JSON.stringify(hits));
r = run(LS, { hook_event_name: "PostToolUse", session_id: "s6", cwd: REPO, tool_name: "Bash", tool_input: { command: "gradle build" }, tool_response: { stdout: "", stderr: "FATAL: daemon crashed", interrupted: false } });
ok("lessons: failing output with no trigger match injects nothing", r.out === "" && r.code === 0, r.out + r.err);

// ---- journal
const JR = hook("hive-journal.js");
const JF = path.join(REPO, ".git", "hive", "journal.jsonl");
const ups = (prompt, extra = {}) => ({ hook_event_name: "UserPromptSubmit", session_id: "s1", transcript_path: T100, cwd: REPO, prompt, ...extra });
r = run(JR, ups("please use postgres, not sqlite, for every service in this run"));
ok("journal: nudge on long prompt", /log it as one line on the run log/.test(ctxOf(r)) && JSON.parse(r.out).hookSpecificOutput.hookEventName === "UserPromptSubmit", r.out + r.err);
ok("journal: appended", JSON.parse(fs.readFileSync(JF, "utf8").trim().split("\n").pop()).prompt.startsWith("please use postgres"));
ok("journal: no nudge for slash / short", run(JR, ups("/hivemind-review something long enough to pass forty chars")).out === "" && run(JR, ups("status")).out === "");
ok("journal: task notification not journaled", (run(JR, ups("<task-notification>done</task-notification>", { source: "system" })), !fs.readFileSync(JF, "utf8").includes("task-notification")));
r = run(JR, ups("go", { transcript_path: T160 }));
ok("journal: meter warns at 160k", /context at 160k/.test(ctxOf(r)), r.out);
ok("journal: meter silent at 100k / after compaction", run(JR, ups("go")).out === "" && run(JR, ups("go", { transcript_path: TCOMP })).out === "");
ok("journal: tail-only read (big file)", run(JR, ups("go", { transcript_path: TBIG })).out === "");
ok("journal: subagent silent", run(JR, ups("a long prompt from somewhere that is not the human at all", sub)).out === "");
const lines = Array.from({ length: 600 }, (_, i) => JSON.stringify({ ts: "t", session_id: "old", prompt: `old prompt ${i}` }));
fs.writeFileSync(JF, lines.join("\n") + "\n");
run(JR, ups("newest message"));
const jl = fs.readFileSync(JF, "utf8").trim().split("\n");
ok("journal: rotates to 500", jl.length === 500 && JSON.parse(jl[499]).prompt === "newest message" && JSON.parse(jl[0]).prompt === "old prompt 101", jl.length);

// ---- inbox + statusline
const IB = hook("hive-inbox.js");
r = run(IB, "", { args: ["--refresh"] });
ok("inbox: refresh prints items", r.out.trim().split("\n").length === 3 && /question #21/.test(r.out) && /review #22/.test(r.out), r.out + r.err);
const cache = JSON.parse(fs.readFileSync(path.join(REPO, ".git", "hive", "inbox.json"), "utf8"));
ok("inbox: cache shape", cache.at && cache.questions.length === 2 && cache.reviews[0].n === 22);
ok("inbox: --count", run(IB, "", { args: ["--count"] }).out.trim() === "2 1");
r = run(IB, "", { args: ["--refresh", "--count"], env: { FAKE_GH: "fail" } });
ok("inbox: gh fail keeps cache", r.code === 0 && r.out.trim() === "2 1", r.out);
ok("inbox: runs from another cwd", run(IB, "", { cwd: W, args: ["--count"] }).out.trim() === "2 1");
r = run(JR, ups("go"));
ok("journal: open questions line", /open questions: #21, #23 \(answer via \/hivemind-review or type questions\)/.test(ctxOf(r)), r.out);
ok("journal: questions line deduped 10 min", !/open questions/.test(ctxOf(run(JR, ups("go")))));
const SL = hook("hive-statusline.js");
const slIn = { session_id: "s1", cwd: REPO, workspace: { current_dir: REPO, project_dir: REPO }, model: { display_name: "Fable" } };
r = run(SL, slIn);
ok("statusline: counts only", r.out.trim() === "hive: 2 questions · 1 review", r.out + r.err);
fs.writeFileSync(path.join(HOME, ".claude", "settings.json"), JSON.stringify({ statusLine: { type: "command", command: "node -e \"let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log('[' + JSON.parse(s).model.display_name + ']'))\"" } }));
r = run(SL, slIn);
ok("statusline: chains user command with same stdin", r.out.trim() === "[Fable] · hive: 2 questions · 1 review", r.out + r.err);
fs.writeFileSync(path.join(HOME, ".claude", "settings.json"), JSON.stringify({ statusLine: { type: "command", command: `node "${SL}"` } }));
ok("statusline: no self-recursion", run(SL, slIn).out.trim() === "hive: 2 questions · 1 review");
fs.writeFileSync(path.join(HOME, ".claude", "settings.json"), "{}");
const past = new Date(Date.now() - 120e3);
fs.utimesSync(path.join(REPO, ".git", "hive", "inbox.json"), past, past);
r = run(SL, slIn, { env: { FAKE_GH: "fail" } });
const lock = path.join(REPO, ".git", "hive", "inbox.refresh");
ok("statusline: stale cache spawns refresh + lock", r.out.trim() === "hive: 2 questions · 1 review" && fs.existsSync(lock));
const lockM = fs.statSync(lock).mtimeMs;
run(SL, slIn, { env: { FAKE_GH: "fail" } });
ok("statusline: refresh at most once per 60 s", fs.statSync(lock).mtimeMs === lockM);
ok("statusline: outside a repo prints empty", run(SL, "{}", { cwd: W }).code === 0);
const slTimes = []; for (let i = 0; i < 5; i++) slTimes.push(run(SL, slIn).ms);

// ---- stall
const ST = hook("hive-stall.js");
const stop = (msg, extra = {}) => ({ hook_event_name: "SubagentStop", session_id: "s1", cwd: REPO, agent_id: "a7", stop_hook_active: false, last_assistant_message: msg, ...extra });
const blocked = (res) => { try { return JSON.parse(res.out).decision === "block"; } catch { return false; } };
ok("stall: blocks waiting on render", blocked(run(ST, stop("Started the Blender render in the background (PID 4411). Waiting on the render to finish, then I will report."))));
ok("stall: blocks will-report-once-finished", blocked(run(ST, stop("Kicked off the build job. I'll report once it finishes."))));
ok("stall: same message not blocked twice", !blocked(run(ST, stop("Kicked off the build job. I'll report once it finishes."))));
ok("stall: DONE not blocked", !blocked(run(ST, stop("DONE #12 sent. Tests green; waiting on the render is no longer needed."))));
ok("stall: VERDICT/NEEDS not blocked", !blocked(run(ST, stop("VERDICT MERGE"))) && !blocked(run(ST, stop("NEEDS src/x.ts: waiting on the backend ticket"))));
ok("stall: stop_hook_active passes", !blocked(run(ST, stop("waiting on the render to finish, will report", { stop_hook_active: true }))));
ok("stall: plain summary passes", !blocked(run(ST, stop("Implemented the lighting rig and all tests pass. Report posted on #12."))));
ok("stall: background_tasks + will check", blocked(run(ST, stop("I will check back on it shortly.", { background_tasks: [{ id: "b1", type: "local_bash", status: "running" }] }))));
const TSUB = tr("sub.jsonl", [asst(1000, "Render running in background; waiting for the job to complete.", true)]);
ok("stall: falls back to agent_transcript_path", blocked(run(ST, stop(undefined, { last_assistant_message: undefined, agent_transcript_path: TSUB }))));
const TTM = tr("tm.jsonl", [asst(1000, "The export job is still running; I'll report when it finishes.")]);
r = run(ST, { hook_event_name: "TeammateIdle", session_id: "tm1", cwd: REPO, transcript_path: TTM, teammate_name: "w1", team_name: "t" });
ok("stall: TeammateIdle exit 2", r.code === 2 && /Poll it now/.test(r.err), r.code + r.err);
ok("stall: TeammateIdle no loop", run(ST, { hook_event_name: "TeammateIdle", session_id: "tm1", cwd: REPO, transcript_path: TTM, teammate_name: "w1" }).code === 0);
ok("stall: worker Stop in worktree", blocked(run(WH("hive-stall.js"), { hook_event_name: "Stop", session_id: "w9", cwd: WT, stop_hook_active: false, last_assistant_message: "Waiting on the background process to finish." }, { cwd: WT })));

// ---- status
r = run(hook("hive-status.js"), "");
ok("status line", r.out.trim() === "run bl1077 · milestone bl1077/lighting 3/6 closed · 2 PRs open (1 verdict) · eta ~30m (median 30m/ticket)", r.out + r.err);
console.log("status: " + r.out.trim());
ok("status gh fail", /tracker unreachable/.test(run(hook("hive-status.js"), "", { env: { FAKE_GH: "fail" } }).out));

// ---- autostart
const AS = hook("hive-autostart.js");
fs.writeFileSync(path.join(HOME, ".claude", "hivemind.json"), JSON.stringify({ home: HSRC, autoUpdate: false, lastFetch: Date.now(), other: 1 }));
fs.writeFileSync(path.join(HSRC, "templates", "hooks", "hive-status.js"), fs.readFileSync(path.join(SRC, "hive-status.js"), "utf8") + "// changed upstream\n");
r = run(AS, { hook_event_name: "SessionStart", source: "startup", session_id: "s1", cwd: REPO });
let L = r.out.split("\n");
ok("autostart: state on line 4", L[3].startsWith("hive-state") && /doc-bloat=CLAUDE-extra\.md:1,CLAUDE\.md:200/.test(L[3]) && /lessons=9/.test(L[3]) && L[3].includes(`hivemind-src=${HSRC}`) && /hivemind-update=1-behind \(node .*install\.js --update\)/.test(L[3]) && /inbox=2q\/1r/.test(L[3]) && /hive-branches=hive\/bl1077( |$)/.test(L[3]), L[3]);
ok("autostart: synced line", r.out.includes(`hivemind: synced 2 files from ${HSRC}`) && fs.readFileSync(path.join(HOME, ".claude", "agents", "hive-worker.md"), "utf8") === "worker v1\n" && fs.readFileSync(hook("hive-status.js"), "utf8").includes("changed upstream"), L.slice(4, 7).join(" | ").slice(0, 400));
ok("autostart: run-log tail on startup with branch", /run-log #7 tail \(newest last\):/.test(r.out) && /decision 15:/.test(r.out) && !/decision 3:/.test(r.out), r.out);
const tailBlock = r.out.slice(r.out.indexOf("run-log #7"), r.out.indexOf("SKILL BODY"));
ok("autostart: run-log capped 3000", tailBlock.length < 3200, tailBlock.length);
ok("autostart: body present", r.out.trim().endsWith("SKILL BODY"));
ok("autostart: models= from the event's model, fable lead staffs opus", /models=lead:fable,top:opus,mid:sonnet( |$)/.test(run(AS, { source: "startup", cwd: REPO, model: "claude-fable-5-1" }).out.split("\n")[3]));
run(AS, { source: "startup", cwd: REPO, session_id: "s9", model: "claude-sonnet-5-5" });
r = run(LG, pre("Agent", { model: "opus", subagent_type: "hive-worker" }, { session_id: "s9" }));
ok("ladder: guard falls back to the model SessionStart saved", r.code === 2 && /above the lead \(claude-sonnet-5-5\)/.test(r.err) && run(LG, pre("Agent", { model: "opus", subagent_type: "hive-worker" })).code === 0, r.err);
ok("autostart: models= for a sonnet lead, and unknown", /models=lead:sonnet,top:sonnet,mid:sonnet/.test(run(AS, { source: "startup", cwd: REPO, model: { id: "claude-sonnet-5-5", display_name: "Sonnet 5.5" } }).out) &&
  /models=lead:unknown,top:opus,mid:sonnet/.test(run(AS, { source: "startup", cwd: REPO }).out));
r = run(AS, { source: "startup", cwd: REPO });
ok("autostart: quiet when nothing to sync", !/synced/.test(r.out));
r = run(AS, { source: "compact", cwd: REPO });
ok("autostart: compact human said", /human said \(verbatim, newest last\):/.test(r.out) && /- newest message/.test(r.out) && /Context was just compacted/.test(r.out), r.out.slice(0, 2500));
const hs = r.out.slice(r.out.indexOf("human said"));
ok("autostart: 10 human messages", (hs.slice(0, hs.indexOf("SKILL")).match(/^- /gm) || []).length === 10);
r = run(AS, { source: "resume", cwd: REPO });
ok("autostart: resume one line", r.out.trim().split("\n").length === 1 && /session resumed/.test(r.out), r.out);
r = run(AS, { source: "compact", cwd: REPO }, { env: { FAKE_GH: "fail" } });
ok("autostart: gh fail silent", r.code === 0 && !/run-log #/.test(r.out) && r.err === "" && /SKILL BODY/.test(r.out), r.err);
ok("autostart: subagent silent", run(AS, { source: "startup", agent_id: "x" }).out === "");
ok("autostart: worktree silent", run(WH("hive-stall.js").replace("hive-stall.js", "../../.claude/hooks/hive-stall.js") && AS, { source: "startup" }, { cwd: WT }).out === "");
// autoUpdate on a clean checkout pulls
fs.writeFileSync(path.join(HOME, ".claude", "hivemind.json"), JSON.stringify({ home: HSRC, autoUpdate: true, lastFetch: 0 }));
g(HSRC, "checkout", "-q", "--", ".");
r = run(AS, { source: "startup", cwd: REPO });
const sha = g(HSRC, "rev-parse", "--short", "HEAD");
ok("autostart: autoUpdate pulls", r.out.includes(`hivemind: updated to ${sha}`) && fs.readFileSync(path.join(HOME, ".claude", "agents", "hive-worker.md"), "utf8") === "worker v2\n" && !/hivemind-update=/.test(r.out), r.out.slice(0, 1500));
const cfg = JSON.parse(fs.readFileSync(path.join(HOME, ".claude", "hivemind.json"), "utf8"));
ok("autostart: lastFetch updated", cfg.lastFetch > Date.now() - 60e3 && cfg.autoUpdate === true);

// ---- scratch: a temp dir as TMPDIR, never the real /tmp
const TMPD = path.join(W, "tmp"); fs.mkdirSync(TMPD);
const OUTSIDE = path.join(W, "outside"); fs.mkdirSync(OUTSIDE); fs.writeFileSync(path.join(OUTSIDE, "keep.txt"), "k");
const SC = hook("hive-scratch.js");
const TENV = { TMPDIR: TMPD };
const LEDGER = path.join(REPO, ".git", "hive", "scratch-ledger.jsonl");
const SCR = path.join(REPO, ".git", "hive", "scratch");
const ledger = () => { try { return fs.readFileSync(LEDGER, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };
const entry = (name) => ledger().find((e) => e.path === path.join(TMPD, name));
const t = (name) => path.join(TMPD, name);
const has = (p) => { try { fs.lstatSync(p); return true; } catch { return false; } };
const wtList = () => g(REPO, "worktree", "list", "--porcelain");
let tu = 0;
// one Bash call: PreToolUse snapshot, make() plays the command, PostToolUse (or Failure) diffs
function bash(command, make, { extra = {}, stdout = "", event = "PostToolUse", script = SC, error } = {}) {
  const ev = { session_id: "s1", cwd: REPO, tool_name: "Bash", tool_use_id: `tu${++tu}`, tool_input: { command }, ...extra };
  const a = run(script, { ...ev, hook_event_name: "PreToolUse" }, { env: TENV });
  if (make) make();
  const b = run(script, { ...ev, hook_event_name: event, ...(event === "PostToolUse" ? { tool_response: { stdout, stderr: "" } } : { error }) }, { env: TENV });
  return [a, b];
}
ok("scratch: registered for Bash pre, post, failure", ["PreToolUse", "PostToolUse", "PostToolUseFailure"].every((e) => (j1.hooks[e] || []).some((x) => x.matcher === "Bash" && JSON.stringify(x).includes("hive-scratch.js"))), JSON.stringify(j1.hooks.PostToolUseFailure));
ok("scratch: in the worktree backup set", fs.existsSync(WH("hive-scratch.js")) && ["PreToolUse", "PostToolUse", "PostToolUseFailure"].every((e) => JSON.stringify(JSON.parse(fs.readFileSync(path.join(WT, ".claude", "settings.local.json"), "utf8")).hooks[e]).includes("hive-scratch.js")));
// the lead's own Bash: named → ledgered under the one open run; unnamed or a longer name → ignored
let rr = bash(`mkdir ${t("hs-lead")} && head -c 2097152 /dev/zero > ${t("hs-lead")}/big && echo ok`, () => {
  fs.mkdirSync(t("hs-lead")); fs.writeFileSync(t("hs-lead/big"), Buffer.alloc(2097152));
  fs.mkdirSync(t("hs-unnamed")); fs.mkdirSync(t("hs-sub-long"));
});
ok("scratch: hook silent, exit 0", rr.every((x) => x.code === 0 && x.out === "" && x.err === ""), JSON.stringify(rr));
let e1 = entry("hs-lead");
ok("scratch: lead creation named in command is ledgered", e1 && e1.key === "bl1077" && e1.agent === "lead" && e1.worktree === false && e1.ino === fs.lstatSync(t("hs-lead")).ino, JSON.stringify(ledger()));
ok("scratch: creation not named is ignored", !entry("hs-unnamed") && !entry("hs-sub-long"));
bash("ls hs-sub", () => fs.mkdirSync(t("hs-sub-2")));
ok("scratch: a name inside a longer word is not a match", !entry("hs-sub-2"));
bash("mktemp -d", () => fs.mkdirSync(t("tmp.AbC123")), { stdout: `${t("tmp.AbC123")}\n` });
ok("scratch: named in output only is ledgered", !!entry("tmp.AbC123"));
bash(`blender -b -o ${t("hs-fail")}/f`, () => fs.mkdirSync(t("hs-fail")), { event: "PostToolUseFailure", error: "Exit code 1" });
ok("scratch: PostToolUseFailure ledgers too", !!entry("hs-fail"));
bash(`touch ${t("hs-lead")}/x`, () => {});
ok("scratch: no duplicate entry for an existing path", ledger().filter((e) => e.path === t("hs-lead")).length === 1);
// another user's file (getuid faked in-process) is ignored
const FOREIGN = path.join(W, "foreign.js");
fs.writeFileSync(FOREIGN, `const u = process.getuid(); process.getuid = () => u + 1; require(${JSON.stringify(SC)});`);
bash(`cat ${t("hs-foreign")}`, () => fs.writeFileSync(t("hs-foreign"), "x"), { script: FOREIGN });
ok("scratch: another user's file is ignored", !entry("hs-foreign") && has(t("hs-foreign")));
// a worker in its worktree: keyed by its branch; a git worktree is flagged
const sw = { agent_id: "w5", agent_type: "hive-worker", cwd: WT };
bash(`git worktree add --detach ${t("hs-wt")} && git worktree add --detach ${t("hs-wtlock")}`, () => {
  g(REPO, "worktree", "add", "-q", "--detach", t("hs-wt")); g(REPO, "worktree", "add", "-q", "--detach", t("hs-wtlock"));
  g(REPO, "worktree", "lock", t("hs-wtlock"));
}, { extra: sw });
let e2 = entry("hs-wt");
ok("scratch: worker keyed by its branch, worktree flagged", e2 && e2.key === "bl1077-5" && e2.agent === "hive-worker:w5" && e2.worktree === true && entry("hs-wtlock").worktree === true, JSON.stringify(e2));
// --path: creates the dir, bumps its mtime, binds the agent that ran it
r = run(SC, "", { args: ["--path", "bl1077-9"] });
const P9 = path.join(SCR, "bl1077-9");
ok("scratch --path creates and prints the dir", r.code === 0 && r.out.trim() === P9 && fs.statSync(P9).isDirectory(), r.out + r.err);
fs.writeFileSync(path.join(P9, "render.png"), Buffer.alloc(1024));
const old = new Date(Date.now() - 5 * 864e5); fs.utimesSync(P9, old, old);
run(SC, "", { args: ["--path", "bl1077-9"] });
ok("scratch --path bumps the mtime", Date.now() - fs.statSync(P9).mtimeMs < 60e3);
ok("scratch --path refuses a bad key", run(SC, "", { args: ["--path", "../x"] }).code === 1 && !has(path.join(REPO, ".git", "hive", "x")) && run(SC, "", { args: ["--path"] }).code === 1);
const sv = { agent_id: "v9", agent_type: "hive-verifier", cwd: REPO };
bash("node .claude/hooks/hive-scratch.js --path bl1077-9", null, { extra: sv, stdout: P9 });
bash(`git clone -q . ${t("hs-clone")}`, () => fs.mkdirSync(t("hs-clone")), { extra: sv });
ok("scratch: --path binds the agent's later strays", entry("hs-clone") && entry("hs-clone").key === "bl1077-9" && ledger().some((e) => e.bind === "hive-verifier:v9" && e.key === "bl1077-9"), JSON.stringify(ledger()));
// symlinks: a link to outside, and a dir holding one; plus a path replaced after it was ledgered
bash(`ln -s ${OUTSIDE} ${t("hs-link")}; mkdir ${t("hs-dir")}; ln -s ${OUTSIDE} ${t("hs-dir")}/out; mkdir ${t("hs-replaced")}`, () => {
  fs.symlinkSync(OUTSIDE, t("hs-link")); fs.mkdirSync(t("hs-dir")); fs.symlinkSync(OUTSIDE, t("hs-dir/out")); fs.mkdirSync(t("hs-replaced"));
});
fs.rmdirSync(t("hs-replaced")); fs.writeFileSync(t("hs-other"), "o"); fs.mkdirSync(t("hs-replaced")); // new inode
// forged ledger lines pointing outside the temp dir
const outIno = fs.lstatSync(path.join(OUTSIDE, "keep.txt")).ino;
fs.appendFileSync(LEDGER, JSON.stringify({ path: path.join(OUTSIDE, "keep.txt"), key: "bl1077", ino: outIno, at: 0 }) + "\n" + JSON.stringify({ path: `${TMPD}/../outside`, key: "bl1077", at: 0 }) + "\nnot json\n");
// ---- sweeps
r = run(SC, "", { args: ["--sweep", "bl1077-5"], env: TENV });
ok("scratch sweep ticket: worktree removed via git, locked one kept", r.code === 0 && !has(t("hs-wt")) && !wtList().includes(`worktree ${t("hs-wt")}\n`) &&
  has(t("hs-wtlock")) && wtList().includes(t("hs-wtlock")) && /kept .*hs-wtlock: git worktree remove failed/.test(r.out) && !!entry("hs-wtlock"), r.out + r.err + wtList());
ok("scratch sweep ticket: nothing else touched", has(t("hs-lead")) && has(t("hs-unnamed")) && has(P9) && !!entry("hs-lead") && /freed .* MB \(0 scratch dirs, 1 strays, 1 worktrees\)/.test(r.out), r.out);
r = run(SC, "", { args: ["--sweep", "bl1077-9"], env: TENV });
ok("scratch sweep ticket: scratch dir and bound strays", !has(P9) && !has(t("hs-clone")) && !ledger().some((e) => e.key === "bl1077-9") && /\(1 scratch dirs, 1 strays/.test(r.out), r.out + JSON.stringify(ledger()));
bash(`touch ${t("hs-owned")}`, () => fs.writeFileSync(t("hs-owned"), "x"));
// only hs-owned reads as another user's (lstat faked in-process); everything else stays ours
const OWNED = path.join(W, "owned.js");
fs.writeFileSync(OWNED, `const fs = require("fs"); const l = fs.lstatSync; fs.lstatSync = (p, o) => { const st = l(p, o); if (String(p).endsWith("hs-owned")) st.uid += 1; return st; }; require(${JSON.stringify(SC)});`);
r = run(OWNED, "", { args: ["--sweep", "bl1077"], env: TENV });
ok("scratch sweep: an entry now owned by another user is dropped untouched", has(t("hs-owned")) && !entry("hs-owned") && !has(t("hs-lead")), r.out + r.err);
ok("scratch sweep run: deletes only ledgered entries", !has(t("tmp.AbC123")) && !has(t("hs-fail")) && !has(t("hs-dir")) &&
  ["hs-unnamed", "hs-sub-long", "hs-sub-2", "hs-foreign", "hs-other", "hs-replaced"].every((n) => has(t(n))), fs.readdirSync(TMPD).join(","));
ok("scratch sweep: symlinks removed as links, targets untouched", !has(t("hs-link")) && fs.readFileSync(path.join(OUTSIDE, "keep.txt"), "utf8") === "k" && fs.readdirSync(OUTSIDE).length === 1);
ok("scratch sweep: forged paths outside the temp dir kept", has(OUTSIDE) && /kept .*outside.*not directly in os\.tmpdir\(\)/.test(r.out) && ledger().some((e) => e.path === path.join(OUTSIDE, "keep.txt")), r.out);
ok("scratch sweep: freed MB printed", /hive-scratch: freed [2-9]\.\d MB/.test(r.out), r.out);
g(REPO, "worktree", "unlock", t("hs-wtlock"));
r = run(SC, "", { args: ["--sweep", "bl1077-5"], env: TENV });
ok("scratch sweep: unlocked worktree removed on the next sweep", !has(t("hs-wtlock")) && !wtList().includes(t("hs-wtlock")), r.out);
ok("scratch sweep: bad arg → usage", run(SC, "", { args: ["--sweep", "--everything"], env: TENV }).code === 1);
r = run(SC, "", { args: ["--size"], env: TENV });
ok("scratch --size", r.code === 0 && /^\d+\.\d MB$/.test(r.out.trim()), r.out + r.err);
// ---- autostart: aged safety sweep in the background, scratch= on the state line
const HOURS = (h) => Date.now() - h * 3600e3;
const aged = (name, key, h, dir = false) => {
  const p = t(name); dir ? fs.mkdirSync(p) : fs.writeFileSync(p, "x");
  const at = new Date(HOURS(h)); fs.utimesSync(p, at, at);
  fs.appendFileSync(LEDGER, JSON.stringify({ path: p, key, agent: "lead", at: HOURS(h), ino: fs.lstatSync(p).ino, worktree: false }) + "\n");
};
aged("hs-old-done", "bl1077-3", 80); aged("hs-old-open", "bl1077-4", 80); aged("hs-ancient", "bl1077-4", 8 * 24); aged("hs-fresh-done", "bl1077-3", 1);
for (const [k, h] of [["bl1077-7", 80], ["bl1077-6", 80], ["bl1077-8", 2]]) { const d = path.join(SCR, k); fs.mkdirSync(d, { recursive: true }); const at = new Date(HOURS(h)); fs.utimesSync(d, at, at); }
fs.writeFileSync(path.join(REPO, ".git", "hive", "scratch-size.json"), JSON.stringify({ at: "x", bytes: 2048 * 1048576 }));
r = run(AS, { hook_event_name: "SessionStart", source: "startup", session_id: "s1", cwd: REPO }, { env: TENV });
ok("autostart: scratch= on the state line over 1 GB", /hive-state .* scratch=2048MB /.test(r.out), r.out.split("\n")[3]);
const asMs = r.ms;
for (let i = 0; i < 100 && has(t("hs-old-done")); i++) spawnSync("sleep", ["0.05"]);
spawnSync("sleep", ["0.3"]);
ok("autostart: aged sweep deletes done-72h and any-7d only", !has(t("hs-old-done")) && !has(t("hs-ancient")) && has(t("hs-old-open")) && has(t("hs-fresh-done")) &&
  !has(path.join(SCR, "bl1077-7")) && has(path.join(SCR, "bl1077-6")) && has(path.join(SCR, "bl1077-8")), fs.readdirSync(TMPD).join(",") + " | " + fs.readdirSync(SCR).join(","));
ok("autostart: sweep runs detached (start not slowed)", asMs < 3000, asMs);
ok("autostart: size cache rewritten, under 1 GB drops scratch=", JSON.parse(fs.readFileSync(path.join(REPO, ".git", "hive", "scratch-size.json"), "utf8")).bytes < 1048576 &&
  !/scratch=/.test(run(AS, { source: "resume", cwd: REPO }, { env: TENV }).out));
// fail open
ok("scratch: garbage stdin exit 0", run(SC, "not json", { env: TENV }).code === 0);
ok("scratch: post without snapshot, odd input exit 0", run(SC, { hook_event_name: "PostToolUse", tool_name: "Bash", tool_use_id: "none", tool_input: { command: 5 }, tool_response: 7 }, { env: TENV }).code === 0);
r = run(SC, { hook_event_name: "PreToolUse", tool_name: "Bash", tool_use_id: "x" }, { env: { TMPDIR: path.join(W, "no-such-dir") } });
ok("scratch: unreadable temp dir exit 0, silent", r.code === 0 && r.out === "" && r.err === "");
ok("scratch: outside git exit 0", run(SC, { hook_event_name: "PreToolUse", tool_name: "Bash", tool_use_id: "y" }, { cwd: W, env: TENV }).code === 0);
ok("scratch: HIVEMIND=0 skips", (() => { bash(`mkdir ${t("hs-off")}`, () => {}); const n = ledger().length; run(SC, { hook_event_name: "PreToolUse", tool_name: "Bash", tool_use_id: "z", tool_input: { command: `mkdir ${t("hs-off2")}` } }, { env: { ...TENV, HIVEMIND: "0" } }); return !fs.existsSync(path.join(REPO, ".git", "hive", "scratch-snap", "z")) && ledger().length === n; })());

// ---- context-mode: required plugin, via the claude CLI; temp HOMEs, a fake claude, the real one never on PATH
const INST = path.join(ROOT, "install.js");
const CTX = "context-mode@context-mode";
const CBIN = path.join(W, "cbin"); fs.mkdirSync(CBIN);
const CLOG = path.join(W, "claude.log");
fs.writeFileSync(path.join(CBIN, "claude"), `#!${process.execPath}
const fs = require("fs"), path = require("path"), os = require("os");
const a = process.argv.slice(2).join(" ");
fs.appendFileSync(process.env.CLAUDE_LOG, a + "\\n");
if (process.env.FAKE_CLAUDE === "fail") process.exit(1);
const d = path.join(os.homedir(), ".claude"), rd = (f) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return {}; } };
fs.mkdirSync(path.join(d, "plugins"), { recursive: true });
if (a === "plugin marketplace add mksglu/context-mode") fs.writeFileSync(path.join(d, "plugins", "known_marketplaces.json"), JSON.stringify({ "context-mode": {} }));
if (a === "plugin install ${CTX} --scope user") fs.writeFileSync(path.join(d, "plugins", "installed_plugins.json"), JSON.stringify({ version: 2, plugins: { "${CTX}": [{ scope: "user" }] } }));
if (a === "plugin install ${CTX} --scope user" || a === "plugin enable ${CTX} --scope user") {
  const s = rd(path.join(d, "settings.json")); s.enabledPlugins = { ...s.enabledPlugins, "${CTX}": true }; fs.writeFileSync(path.join(d, "settings.json"), JSON.stringify(s));
}
`, { mode: 0o755 });
const OLDNODE = path.join(W, "oldnode.js");
fs.writeFileSync(OLDNODE, `Object.defineProperty(process, "versions", { value: { ...process.versions, node: process.env.FAKE_NODE } });\n`);
const CWD = path.join(W, "plain"); fs.mkdirSync(CWD);
const chome = (n) => { const h = path.join(W, "ch-" + n); fs.mkdirSync(path.join(h, ".claude"), { recursive: true }); return h; };
const cenv = (h, extra = {}) => ({ HOME: h, CLAUDE_LOG: CLOG, PATH: `${CBIN}:${BIN}:/usr/bin:/bin`, ...extra });
const clog = () => { try { return fs.readFileSync(CLOG, "utf8").split("\n").filter(Boolean); } catch { return []; } };
const ctxLine = (out) => (out.split("\n").find((l) => l.includes(`${CTX} plugin`)) || "");
const cjson = (h, ...f) => JSON.parse(fs.readFileSync(path.join(h, ".claude", ...f), "utf8"));
let CH = chome("none");
r = run(INST, "", { cwd: CWD, env: { HOME: CH } });
ok("context-mode: no claude CLI → commands printed, install still done", r.code === 0 && /warning: the required context-mode plugin is not installed\. Run:\n  claude plugin marketplace add mksglu\/context-mode\n  claude plugin install context-mode@context-mode --scope user\n/.test(r.err) &&
  /Done\. \/hivemind/.test(r.out) && fs.existsSync(path.join(CH, ".claude", "agents", "hive-worker.md")), r.out + r.err);
r = run(INST, "", { cwd: CWD, env: cenv(CH) });
ok("context-mode: installer runs marketplace add, then install at user scope", r.code === 0 && JSON.stringify(clog()) === JSON.stringify(["plugin marketplace add mksglu/context-mode", `plugin install ${CTX} --scope user`]) &&
  r.out.includes(`plugin   -> ${CTX} installed`) && !/context-mode plugin is not/.test(r.err), clog().join(" | ") + r.out + r.err);
const cs = cjson(CH, "settings.json");
ok("context-mode: attribution written beside the CLI's enabledPlugins", cs.enabledPlugins[CTX] === true && cs.attribution && cs.attribution.commit === "", JSON.stringify(cs));
r = run(INST, "", { cwd: CWD, env: cenv(CH) });
ok("context-mode: already on → no CLI call", clog().length === 2 && r.out.includes(`plugin   -> ${CTX} enabled`), clog().join(" | "));
r = run(INST, "", { args: ["--doctor"], cwd: CWD, env: cenv(CH) });
ok("doctor: context-mode installed and enabled → ok", ctxLine(r.out) === `ok   ${CTX} plugin`, r.out);
fs.writeFileSync(path.join(CH, ".claude", "settings.json"), JSON.stringify({ ...cs, enabledPlugins: { [CTX]: false } }));
r = run(INST, "", { args: ["--doctor"], cwd: CWD, env: cenv(CH) });
ok("doctor: context-mode disabled → FIX with the enable command, exit 1", r.code === 1 && ctxLine(r.out) === `FIX  ${CTX} plugin (required) disabled — claude plugin enable ${CTX} --scope user`, r.out);
r = run(INST, "", { args: ["--doctor", "--fix"], cwd: CWD, env: cenv(CH) });
ok("doctor --fix: enables through the CLI only", clog().slice(2).join("|") === `plugin enable ${CTX} --scope user` && ctxLine(r.out) === `ok   ${CTX} plugin (fixed)`, clog().join(" | ") + r.out);
CH = chome("missing");
r = run(INST, "", { args: ["--doctor"], cwd: CWD, env: cenv(CH) });
ok("doctor: context-mode missing → FIX with both commands", r.code === 1 && ctxLine(r.out) === `FIX  ${CTX} plugin (required) missing — claude plugin marketplace add mksglu/context-mode && claude plugin install ${CTX} --scope user`, r.out);
ok("doctor: read only (no CLI call, nothing written)", clog().length === 3 && !fs.existsSync(path.join(CH, ".claude", "plugins")) && !fs.existsSync(path.join(CH, ".claude", "settings.json")));
fs.writeFileSync(CLOG, "");
r = run(INST, "", { cwd: CWD, env: cenv(CH, { FAKE_CLAUDE: "fail" }) });
ok("context-mode: CLI failure stops at the failed step, prints the commands, not fatal", r.code === 0 && clog().join("|") === "plugin marketplace add mksglu/context-mode" &&
  /not installed\. Run:\n  claude plugin marketplace add .*\n  claude plugin install /.test(r.err), clog().join(" | ") + r.err);
// node version, mocked through a preload
CH = chome("oldnode");
r = run(INST, "", { cwd: CWD, env: cenv(CH, { NODE_OPTIONS: `--require ${OLDNODE}`, FAKE_NODE: "22.4.9" }) });
ok("node < 22.5: install dies with the fix, writes nothing", r.code === 1 && /node 22\.4\.9 is older than 22\.5\.0, which the required context-mode plugin needs\. Upgrade: .*nodejs\.org, then re-run/.test(r.err) &&
  fs.readdirSync(path.join(CH, ".claude")).length === 0 && clog().length === 1, r.err);
const nodeLine = (v) => run(INST, "", { args: ["--doctor"], cwd: CWD, env: cenv(CH, { NODE_OPTIONS: `--require ${OLDNODE}`, FAKE_NODE: v }) }).out.split("\n")[0];
ok("doctor: node 20.11.0 → FIX", /^FIX  node 20\.11\.0 is older than 22\.5\.0 \(context-mode needs it\) — .*nodejs\.org$/.test(nodeLine("20.11.0")), nodeLine("20.11.0"));
ok("doctor: node 22.5.0 and 23.0.1 → ok", nodeLine("22.5.0") === "ok   node 22.5.0" && nodeLine("23.0.1") === "ok   node 23.0.1");
// autostart: context-mode=missing on the state line, a cheap read of the same two files
const PLUG = path.join(HOME, ".claude", "plugins", "installed_plugins.json"), HSET = path.join(HOME, ".claude", "settings.json");
const hsetBefore = fs.existsSync(HSET) ? fs.readFileSync(HSET, "utf8") : null;
const asLine = () => run(AS, { hook_event_name: "SessionStart", source: "startup", session_id: "s1", cwd: REPO }).out.split("\n")[3] || "";
ok("autostart: context-mode=missing when absent", / context-mode=missing( |$)/.test(asLine()), asLine());
fs.mkdirSync(path.dirname(PLUG), { recursive: true });
fs.writeFileSync(PLUG, JSON.stringify({ version: 2, plugins: { [CTX]: [{ scope: "user" }] } }));
ok("autostart: context-mode=missing when installed but not enabled", /context-mode=missing/.test(asLine()));
fs.writeFileSync(HSET, JSON.stringify({ ...(hsetBefore ? JSON.parse(hsetBefore) : {}), enabledPlugins: { [CTX]: true } }));
ok("autostart: no context-mode flag when installed and enabled", /^hive-state/.test(asLine()) && !/context-mode/.test(asLine()), asLine());
fs.rmSync(path.dirname(PLUG), { recursive: true }); hsetBefore === null ? fs.rmSync(HSET) : fs.writeFileSync(HSET, hsetBefore);

// install strips the keys of the removed classifier option, keeps the rest
CH = chome("stale");
fs.writeFileSync(path.join(CH, ".claude", "hivemind.json"), JSON.stringify({ autoUpdate: true, lastFetch: 5, laya: { url: "http://127.0.0.1:9", threshold: 0.8 }, layaOffered: true }));
r = run(INST, "", { cwd: CWD, env: cenv(CH) });
const hj = cjson(CH, "hivemind.json");
ok("install: strips laya and layaOffered from hivemind.json", r.code === 0 && !("laya" in hj) && !("layaOffered" in hj) && hj.autoUpdate === true && hj.lastFetch === 5 && hj.home === ROOT &&
  !/laya/i.test(r.out + r.err), JSON.stringify(hj) + r.out + r.err);

// ---- tour offer + update notice: own HOME, the same hivemind source checkout
{
  const TH = chome("tour");
  const tcfg = () => cjson(TH, "hivemind.json");
  const setCfg = (o) => fs.writeFileSync(path.join(TH, ".claude", "hivemind.json"), JSON.stringify({ home: HSRC, autoUpdate: false, lastFetch: Date.now(), ...o }));
  const start = (source = "startup") => run(AS, { hook_event_name: "SessionStart", source, session_id: "t1", cwd: REPO }, { env: { HOME: TH } });
  const head = () => g(HSRC, "rev-parse", "HEAD");
  setCfg({ toured: "" });
  r = start();
  ok("tour: first-time offer as a note, not on the state line", /^hivemind tour=new: open your first reply with this one line/m.test(r.out) && r.out.includes("New to hivemind? Type `tour`") &&
    !/tour=/.test(r.out.split("\n")[3]) && tcfg().tourOffers === 1, r.out.slice(0, 1500));
  ok("tour: no offer on resume or compact", !/tour=/.test(start("resume").out) && !/tour=/.test(start("compact").out) && tcfg().tourOffers === 1);
  start(); start();
  ok("tour: offered three times", tcfg().tourOffers === 3);
  r = start();
  ok("tour: fourth start records it declined, silent", !/tour=/.test(r.out) && tcfg().toured === head() && !("tourOffers" in tcfg()), JSON.stringify(tcfg()));
  ok("tour: toured at HEAD stays silent", !/tour=|New to hivemind/.test(start().out));
  // a feature lands upstream and reaches the checkout
  const was = head();
  for (const [m, f] of [["feat: shiny", "a"], ["fix: small", "b"], ["chore: tidy", "c"], ["refactor!: rename flag", "d"]]) {
    g(OTHER, "pull", "-q"); fs.writeFileSync(path.join(OTHER, f), f); g(OTHER, "add", "-A"); g(OTHER, "commit", "-qm", m); g(OTHER, "push", "-q");
  }
  g(HSRC, "fetch", "-q");
  setCfg({ toured: was });
  r = start();
  ok("update notice: behind-count stored for the status line", tcfg().behind === 4 && /hivemind-update=4-behind/.test(r.out.split("\n")[3]), JSON.stringify(tcfg()));
  ok("tour: nothing new in the checkout yet → silent", !/tour=/.test(r.out));
  const slRun = () => run(SL, JSON.stringify({ cwd: CWD }), { cwd: CWD, env: { HOME: TH } }).out.trim();
  ok("statusline: update ready while behind", slRun().endsWith(" · hivemind: update ready (install.js --update)"), slRun());
  g(HSRC, "merge", "-q", "--ff-only", "@{u}");
  r = start();
  ok("tour: whats-new counts feat and breaking only", /^hivemind tour=whats-new:2: /m.test(r.out) && r.out.includes("hivemind has 2 new features since your last tour") && tcfg().tourOffers === 1, r.out.slice(0, 1500));
  ok("update notice: behind cleared once up to date", !("behind" in tcfg()) && !/hivemind-update=/.test(r.out) && !slRun().includes("hivemind:"), JSON.stringify(tcfg()) + slRun());
  setCfg({ toured: "0123456789abcdef0123456789abcdef01234567" });
  ok("tour: unknown toured commit → silent", !/tour=/.test(start().out));
  // auto-update: an install from before the tour gets a what's-new baseline, a first-time one keeps its first tour
  g(HSRC, "reset", "-q", "--hard", "HEAD~2");
  const pre = head();
  setCfg({ autoUpdate: true });
  r = start();
  ok("autoUpdate: pre-tour install gets the pre-update commit as tour baseline", /hivemind: updated to/.test(r.out) && tcfg().toured === pre && /tour=whats-new:1/.test(r.out), JSON.stringify(tcfg()) + r.out.slice(0, 800));
  g(HSRC, "reset", "-q", "--hard", "HEAD~1");
  setCfg({ autoUpdate: true, toured: "" });
  r = start();
  ok("autoUpdate: first-time install keeps tour=new", tcfg().toured === "" && /tour=new/.test(r.out), JSON.stringify(tcfg()));
}
// installer: first install marks the first-time tour and says so; --tour-done records it
{
  const IH = chome("tour-inst");
  r = run(INST, "", { cwd: CWD, env: cenv(IH) });
  ok("install: fresh config has toured \"\" and the tour hint", r.code === 0 && cjson(IH, "hivemind.json").toured === "" && /New to hivemind\? Type \/hivemind tour/.test(r.out), r.out);
  r = run(INST, "", { cwd: CWD, env: cenv(IH) });
  ok("install: no tour hint on a re-install", r.code === 0 && !/New to hivemind/.test(r.out));
  const OH = chome("tour-old");
  fs.writeFileSync(path.join(OH, ".claude", "hivemind.json"), JSON.stringify({ autoUpdate: false }));
  r = run(INST, "", { cwd: CWD, env: cenv(OH) });
  ok("install: existing config gets no toured key", !("toured" in cjson(OH, "hivemind.json")) && !/New to hivemind/.test(r.out), JSON.stringify(cjson(OH, "hivemind.json")));
  fs.writeFileSync(path.join(IH, ".claude", "hivemind.json"), JSON.stringify({ ...cjson(IH, "hivemind.json"), tourOffers: 2 }));
  r = run(INST, "", { args: ["--tour-done"], cwd: CWD, env: cenv(IH) });
  const realHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: path.dirname(INST), encoding: "utf8" }).trim();
  ok("--tour-done: records HEAD, drops the offer count", r.code === 0 && cjson(IH, "hivemind.json").toured === realHead && !("tourOffers" in cjson(IH, "hivemind.json")) && /tour     -> done at/.test(r.out), r.out + r.err);
  ok("--tour-done: takes no other flag", run(INST, "", { args: ["--tour-done", "--project"], cwd: CWD, env: cenv(IH) }).code === 2);
}
// --update prints what's new and sets a what's-new baseline for a pre-tour config
{
  const UB = path.join(W, "upd.git"), UA = path.join(W, "upd-a"), UC = path.join(W, "upd-c");
  const HM = path.dirname(INST);
  g(W, "init", "-q", "--bare", "-b", "main", UB);
  g(W, "clone", "-q", UB, UA);
  for (const f of execFileSync("git", ["ls-files"], { cwd: HM, encoding: "utf8" }).split("\n").filter(Boolean)) {
    fs.mkdirSync(path.dirname(path.join(UA, f)), { recursive: true }); fs.copyFileSync(path.join(HM, f), path.join(UA, f));
  }
  g(UA, "add", "-A"); g(UA, "commit", "-qm", "chore: snapshot"); g(UA, "push", "-q", "-u", "origin", "HEAD:main");
  g(W, "clone", "-q", UB, UC);
  const before = g(UC, "rev-parse", "HEAD");
  for (const m of ["feat: shiny thing", "docs: words", "fix: a bug"]) { fs.appendFileSync(path.join(UA, "README.md"), m + "\n"); g(UA, "commit", "-qam", m); }
  g(UA, "push", "-q");
  const UH = chome("upd");
  fs.writeFileSync(path.join(UH, ".claude", "hivemind.json"), JSON.stringify({ home: UC, autoUpdate: false, behind: 3 }));
  r = run(path.join(UC, "install.js"), "", { args: ["--update"], cwd: CWD, env: { ...cenv(UH), ...ENV, HOME: UH, PATH: cenv(UH).PATH } });
  const uj = cjson(UH, "hivemind.json");
  ok("--update: lists feat and fix subjects, not docs", r.code === 0 && /\n  feat: shiny thing\n  fix: a bug\n/.test(r.out) && !/docs: words/.test(r.out), r.out + r.err);
  ok("--update: pre-tour config gets the old HEAD as tour baseline, behind cleared", uj.toured === before && !("behind" in uj) && uj.home === UC, JSON.stringify(uj));
}

// ---- commit-msg
const CM = path.join(SRC, "commit-msg.js");
const cm = (msg) => { const f = path.join(W, "MSG"); fs.writeFileSync(f, msg); return run(CM, "", { args: [f] }).code; };
ok("commit-msg: good", cm("feat(api): add thing\n\nbody\n") === 0);
ok("commit-msg: scissors diff ignored", cm("fix: x\n# ------------------------ >8 ------------------------\n" + "d".repeat(120) + "\n") === 0);
ok("commit-msg: bad subject", cm("Added stuff\n") === 1);
ok("commit-msg: trailer", cm("fix: x\n\nCo-Authored-By: Claude <x>\n") === 1);

// ---- project install: an agent matching a past shipped version is an old copy, an edit is kept
{
  const PR = path.join(W, "proj-old"); fs.mkdirSync(path.join(PR, ".claude", "agents"), { recursive: true });
  execFileSync("git", ["init", "-q", PR]);
  const old = execFileSync("git", ["show", "5cbb588:agents/hive-guide.md"], { cwd: path.dirname(INST), encoding: "utf8" });
  fs.writeFileSync(path.join(PR, ".claude", "agents", "hive-guide.md"), old.replace(/\n/g, "\r\n"));
  fs.writeFileSync(path.join(PR, ".claude", "agents", "hive-scout.md"), "---\nname: hive-scout\n---\nmine\n");
  const PH = chome("proj-old");
  r = run(INST, "", { args: ["--project"], cwd: PR, env: cenv(PH) });
  ok("project: past shipped agent removed (CRLF too), edited one kept", r.code === 0 && !fs.existsSync(path.join(PR, ".claude", "agents", "hive-guide.md")) &&
    fs.existsSync(path.join(PR, ".claude", "agents", "hive-scout.md")) && /local override kept: \.claude\/agents\/hive-scout\.md/.test(r.out), r.out + r.err);
}

// ---- harness adapter: hooks see one hive event, whatever the CLI
{
  const ad = require(path.join(SRC, "hive-harness-claude.js"));
  const e1 = ad.event({ hook_event_name: "PreToolUse", session_id: "s9", cwd: REPO, tool_name: "MultiEdit", tool_input: { file_path: "a.ts" }, agent_id: "a2", agent_type: "hive-worker" });
  ok("adapter: PreToolUse MultiEdit is a pre-tool edit with path and agent", e1.kind === "pre-tool" && e1.tool === "edit" && e1.path === "a.ts" && e1.agent === "a2" && e1.agentType === "hive-worker" && e1.session === "s9", JSON.stringify(e1));
  const e2 = ad.event({ hook_event_name: "PreToolUse", tool_name: "Agent", tool_input: { model: "opus", prompt: "x" } });
  ok("adapter: Agent is a spawn carrying its model", e2.tool === "spawn" && e2.spawnModel === "opus", JSON.stringify(e2));
  const e3 = ad.event({ hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command: "ls", run_in_background: true }, tool_response: { stdout: "o", stderr: "e" } });
  ok("adapter: Bash post-tool has command, background and output", e3.kind === "post-tool" && e3.tool === "shell" && e3.command === "ls" && e3.background === true && /o/.test(e3.output) && /e/.test(e3.output), JSON.stringify(e3));
  const e4 = ad.event({ hook_event_name: "UserPromptSubmit", prompt: "hi", source: "hook" });
  ok("adapter: a hook-sourced prompt is not from the human", e4.kind === "prompt" && e4.prompt === "hi" && e4.fromHuman === false, JSON.stringify(e4));
  const e5 = ad.event({ hook_event_name: "SessionStart", source: "compact", model: { id: "claude-opus-5-5", display_name: "Opus" } });
  ok("adapter: SessionStart model object reduces to its id", e5.kind === "session-start" && e5.source === "compact" && e5.model === "claude-opus-5-5", JSON.stringify(e5));
  const e6 = ad.event({ hook_event_name: "Stop", stop_hook_active: true, background_tasks: [{}] });
  ok("adapter: Stop carries stopActive and busy", e6.kind === "stop" && e6.stopActive === true && e6.busy === true, JSON.stringify(e6));
  const e7 = ad.event({ hook_event_name: "SomethingNew", tool_name: "WebFetch" });
  ok("adapter: unknown event and tool normalise to empty", e7.kind === "" && e7.tool === "" && e7.toolName === "WebFetch", JSON.stringify(e7));
  r = run(LG, pre("Edit", { file_path: path.join(REPO, "src/a.ts") }), { env: { HIVE_HARNESS: "no-such-cli" } });
  ok("adapter: unknown HIVE_HARNESS falls back to claude, guard still denies", r.code === 2 && /hivemind:/.test(r.err), r.out + r.err);
  ok("adapter: worktree gets the harness files", ["hive-harness.js", "hive-harness-claude.js"].every((f) => fs.existsSync(path.join(WT, ".claude", "hooks", f))));
  r = run(WH("hive-owned-paths.js"), wpre("Edit", { file_path: "/etc/x" }), { cwd: WT, env: { HIVE_HARNESS: "../../etc/passwd" } });
  ok("adapter: HIVE_HARNESS path characters stripped, worker hook still enforces", r.code === 2, r.out + r.err);
}

// ---- Codex adapter: hooks installed in <repo>/.codex/hooks pick it up without HIVE_HARNESS
{
  const CX = path.join(W, "cx"); fs.mkdirSync(CX);
  g(CX, "init", "-q", "-b", "main");
  fs.mkdirSync(path.join(CX, ".agents", "skills", "hivemind"), { recursive: true });
  fs.writeFileSync(path.join(CX, ".agents", "skills", "hivemind", "SKILL.md"), "---\nname: hivemind\n---\nCODEX SKILL BODY\n");
  fs.writeFileSync(path.join(CX, "AGENTS.md"), "## Learned\n");
  g(CX, "add", "-A"); g(CX, "commit", "-qm", "init");
  const CXH = path.join(W, "cxhome"); fs.mkdirSync(path.join(CXH, ".claude"), { recursive: true }); fs.mkdirSync(path.join(CXH, ".codex"));
  fs.writeFileSync(path.join(CXH, ".claude", "hivemind.json"), JSON.stringify({ autoUpdate: false, lastFetch: Date.now() }));
  const cenvx = { HOME: CXH, CODEX_HOME: path.join(CXH, ".codex") };
  r = run(path.join(SRC, "install-lead-hooks.js"), "", { cwd: CX, env: { ...cenvx, HIVE_HARNESS: "codex" } });
  const hj = JSON.parse(fs.readFileSync(path.join(CX, ".codex", "hooks.json"), "utf8"));
  const guardCmd = (hj.hooks.PreToolUse || []).find((e) => /hive-lead-guard/.test(JSON.stringify(e)));
  ok("codex install: .codex/hooks.json with absolute hook paths, exact-name guard matcher, rules file", r.code === 0 && /HIVEMIND=0 codex skips them/.test(r.out) &&
    guardCmd && guardCmd.matcher === "^(apply_patch|Bash|view_image|[a-z_]*spawn_agent)$" && guardCmd.hooks[0].command === `node "${path.join(CX, ".codex", "hooks", "hive-lead-guard.js")}"` &&
    hj.hooks.SessionStart[0].hooks[0].timeout === 60 && !hj.hooks.PostToolUseFailure && !hj.hooks.TeammateIdle &&
    /prefix_rule\(pattern=\["gh"\]/.test(fs.readFileSync(path.join(CX, ".codex", "rules", "hivemind.rules"), "utf8")) && fs.existsSync(path.join(CX, ".codex", "hooks", "hive-harness-codex.js")), r.out + r.err);
  r = run(path.join(SRC, "install-lead-hooks.js"), "", { cwd: CX, env: { ...cenvx, HIVE_HARNESS: "codex" } });
  ok("codex install: idempotent", /hooks already registered, 0 files updated/.test(r.out), r.out + r.err);

  const CG = path.join(CX, ".codex", "hooks", "hive-lead-guard.js");
  const TCX = tr("cx-rollout.jsonl", [
    JSON.stringify({ timestamp: "t", type: "turn_context", payload: { model: "gpt-6-sol", cwd: CX } }),
    JSON.stringify({ timestamp: "t", type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "check shot_0042.png please" }] } }),
    JSON.stringify({ timestamp: "t", type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "<environment_context>other.png</environment_context>" }] } }),
    JSON.stringify({ timestamp: "t", type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "on it" }] } }),
    JSON.stringify({ timestamp: "t", type: "event_msg", payload: { type: "token_count", info: { last_token_usage: { total_tokens: 185000 }, total_token_usage: { total_tokens: 900000 }, model_context_window: 272000 } } }),
  ]);
  const cpre = (tool, ti, extra = {}) => ({ hook_event_name: "PreToolUse", session_id: "c1", transcript_path: TCX, cwd: CX, model: "gpt-6-sol", permission_mode: "default", turn_id: "t1", tool_name: tool, tool_input: ti, tool_use_id: "u1", ...extra });
  const patch = (...files) => ({ command: ["*** Begin Patch", ...files.map((x) => `*** Update File: ${x}\n@@\n-a\n+b`), "*** End Patch"].join("\n") });
  const cg = (inp, env = {}) => run(CG, inp, { cwd: CX, env: { ...cenvx, ...env } });
  r = cg(cpre("apply_patch", patch("AGENTS.md", "src/a.ts")));
  ok("codex guard: a patch touching a deliverable is denied, even beside a lead doc", r.code === 2 && /the lead does not edit src\/a\.ts/.test(r.err) && /HIVEMIND=0 codex/.test(r.err), r.out + r.err);
  ok("codex guard: a patch of lead docs only is allowed", cg(cpre("apply_patch", patch("AGENTS.md", "docs/adr/0001-x.md"))).code === 0);
  ok("codex guard: apply_patch run through the shell is an edit", cg(cpre("Bash", { command: "apply_patch <<'EOF'\n" + patch("src/b.ts").command + "\nEOF" })).code === 2);
  ok("codex guard: plain shell allowed, --edit-last denied", cg(cpre("Bash", { command: "git status" })).code === 0 && cg(cpre("Bash", { command: "gh issue comment 3 --edit-last -b x" })).code === 2);
  r = cg(cpre("spawn_agent", { message: "x", agent_type: "hive-worker", model: "gpt-6-luna" }));
  ok("codex guard: single-model mode, a spawn on another model is denied", r.code === 2 && /not on the ladder \(gpt-6-sol\)/.test(r.err), r.err);
  ok("codex guard: single-model mode, the lead's model is allowed", cg(cpre("spawn_agent", { message: "x", model: "gpt-6-sol" }, { transcript_path: null })).code === 0);
  ok("codex guard: a multi-agent v2 spawn (collaborationspawn_agent) is checked too", cg(cpre("collaborationspawn_agent", { task_name: "t", message: "gAAAA", model: "gpt-6-luna" })).code === 2);
  { const m = new RegExp("^(apply_patch|Bash|view_image|[a-z_]*spawn_agent)$");
    ok("codex guard matcher: every spawn_agent namespace, not wait_agent", m.test("spawn_agent") && m.test("collaborationspawn_agent") && !m.test("collaborationwait_agent") && !m.test("mcp__x__Bash")); }
  ok("codex guard: a spawn without a model is denied", /names its model/.test(cg(cpre("spawn_agent", { message: "x" })).err));
  const HCX = path.join(CXH, ".claude", "hivemind.json");
  fs.writeFileSync(HCX, JSON.stringify({ autoUpdate: false, lastFetch: Date.now(), models: { ladder: ["gpt-6-luna", "gpt-6-sol"], floor: "gpt-6-luna", solo: [] } }));
  ok("codex guard: with models.ladder set, the lower rung is allowed", cg(cpre("spawn_agent", { message: "x", model: "gpt-6-luna" }, { transcript_path: null })).code === 0);
  fs.writeFileSync(HCX, JSON.stringify({ autoUpdate: false, lastFetch: Date.now() }));
  r = cg(cpre("spawn_agent", { message: "x", model: "gpt-6-sol" }));
  ok("codex guard: spawns refused at the handoff line from the rollout's token_count", r.code === 2 && /context at 185k/.test(r.err), r.err);
  ok("codex guard: view_image of a file the human named is allowed", cg(cpre("view_image", { path: "renders/shot_0042.png" })).out === "");
  r = cg(cpre("view_image", { path: "renders/other.png" }));
  ok("codex guard: view_image of an unnamed image is denied (injected context does not count)", /permissionDecision":"deny"/.test(r.out), r.out + r.err);
  ok("codex guard: HIVE_HARNESS=claude overrides the install location", cg(cpre("apply_patch", patch("src/a.ts")), { HIVE_HARNESS: "claude" }).code === 0);

  // worker worktree and owned paths, the owned list under .codex
  const CWT = path.join(W, "cx-wt");
  g(CX, "worktree", "add", "-q", "-b", "hive/cx-1", CWT);
  r = run(path.join(CX, ".codex", "hooks", "hive-worktree.js"), "", { cwd: CX, args: [CWT, "src/lighting/"], env: cenvx });
  ok("codex worktree: hooks and the owned list under .codex, nothing untracked", r.code === 0 && fs.readFileSync(path.join(CWT, ".codex", "hive-owned"), "utf8").includes("src/lighting/") &&
    fs.existsSync(path.join(CWT, ".codex", "hooks", "hive-harness-codex.js")) && !fs.existsSync(path.join(CWT, ".claude")) && g(CWT, "status", "--porcelain") === "", r.out + r.err + g(CWT, "status", "--porcelain"));
  const COP = path.join(CWT, ".codex", "hooks", "hive-owned-paths.js");
  const wp = (...files) => ({ ...cpre("apply_patch", patch(...files)), cwd: CWT });
  ok("codex owned: a patch inside the owned paths is allowed", run(COP, wp("src/lighting/a.ts"), { cwd: CWT, env: cenvx }).code === 0);
  r = run(COP, wp("src/lighting/a.ts", "src/other.ts"), { cwd: CWT, env: cenvx });
  ok("codex owned: one unowned file in a patch denies it", r.code === 2 && /src\/other\.ts/.test(r.err), r.err);
  r = run(CG, { ...wp("src/other.ts"), agent_id: "t-9", agent_type: "hive-worker" }, { cwd: CX, env: cenvx });
  ok("codex guard: a subagent's patch outside its owned paths is denied by the lead's hook", r.code === 2 && /src\/other\.ts/.test(r.err), r.err);

  // autostart: plain stdout is the context; agents land in CODEX_HOME as TOML
  r = run(path.join(CX, ".codex", "hooks", "hive-autostart.js"), { hook_event_name: "SessionStart", session_id: "c1", cwd: CX, model: "gpt-6-sol", source: "startup", transcript_path: null }, { cwd: CX, env: cenvx });
  ok("codex autostart: skill body from .agents/skills as plain stdout, models= from the event", r.code === 0 && r.out.trim().endsWith("CODEX SKILL BODY") && !r.out.startsWith("{") &&
    /models=lead:gpt-6-sol,top:gpt-6-sol,mid:gpt-6-sol/.test(r.out), r.out.slice(0, 800) + r.err);
  r = run(path.join(CX, ".codex", "hooks", "hive-journal.js"), { hook_event_name: "UserPromptSubmit", session_id: "c1", cwd: CX, model: "gpt-6-sol", transcript_path: TCX, prompt: "go" }, { cwd: CX, env: cenvx });
  ok("codex journal: context as UserPromptSubmit additionalContext", /"hookEventName":"UserPromptSubmit"/.test(r.out) && /185k/.test(r.out), r.out + r.err);
  r = run(path.join(CX, ".codex", "hooks", "hive-stall.js"), { hook_event_name: "SubagentStop", session_id: "c1", cwd: CX, model: "gpt-6-sol", agent_id: "t-2", agent_type: "hive-worker", stop_hook_active: false, last_assistant_message: "Waiting for the background build to finish.", transcript_path: TCX }, { cwd: CX, env: cenvx });
  ok("codex stall: a subagent stopping to wait keeps going, as JSON", /"decision":"block"/.test(r.out) && r.code === 0, r.out + r.err);

  const cx = require(path.join(SRC, "hive-harness-codex.js"));
  const ag = cx.agentFile("hive-worker.md", fs.readFileSync(path.join(ROOT, "agents", "hive-worker.md"), "utf8"));
  ok("codex agentFile: TOML role with instructions and no model (the spawn picks it)", ag.name === "hive-worker.toml" && /^name = "hive-worker"$/m.test(ag.text) &&
    /^description = "hivemind generic worker/m.test(ag.text) && /^developer_instructions = ".+"$/m.test(ag.text) && !/^model/m.test(ag.text) && cx.agentFile("x.md", "no frontmatter") === null, ag.text.slice(0, 300));
  const cev = { raw: { transcript_path: tr("cx-comp.jsonl", [JSON.stringify({ type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "old ask" }] } }), JSON.stringify({ type: "compacted", payload: { message: "sum" } })]) }, model: "" };
  ok("codex readers: no human prompt across a compaction; model from turn_context", cx.lastHumanPrompt(cev) === null && cx.sessionModel({ raw: { transcript_path: TCX }, model: "" }) === "gpt-6-sol");
  const kinds = { type: "response_item", payload: { type: "message", role: "user", internal_chat_message_metadata_passthrough: { content_item_kinds: ["hooks.additional_context"] }, content: [{ type: "input_text", text: "looks human" }] } };
  ok("codex readers: user-role items tagged as injected are skipped", cx.lastHumanPrompt({ raw: { transcript_path: tr("cx-k.jsonl", [JSON.stringify({ type: "event_msg", payload: { type: "user_message", message: "typed" } }), JSON.stringify(kinds)]) } }) === "typed");
  const e = cx.event({ hook_event_name: "PreToolUse", cwd: "/r", tool_name: "apply_patch", tool_input: { command: "*** Begin Patch\n*** Add File: a/new.ts\n+x\n*** Update File: b.ts\n*** Move to: c.ts\n*** Delete File: /abs/d.ts\n*** End Patch" } });
  ok("codex event: every patch path, resolved against cwd; the patch is not a shell command", JSON.stringify(e.paths) === JSON.stringify(["/r/a/new.ts", "/r/b.ts", "/r/c.ts", "/abs/d.ts"]) && e.tool === "edit" && e.command === "" && e.path === "/r/a/new.ts", JSON.stringify(e.paths));
}

// ---- installer, --harness codex: temp HOME and CODEX_HOME; the claude CLI is never called
{
  const XH = chome("codex"), XC = path.join(XH, ".codex");
  const xenv = (extra = {}) => cenv(XH, { CODEX_HOME: XC, ...extra });
  const shipped = fs.readdirSync(path.join(ROOT, "agents")).filter((f) => f.endsWith(".md"));
  const link = (s) => path.join(XH, ".agents", "skills", s);
  const calls = clog().length;
  r = run(INST, "", { args: ["--harness", "codex"], cwd: CWD, env: xenv() });
  ok("codex install: skills linked into ~/.agents/skills, agents as TOML in CODEX_HOME, only hivemind.json under ~/.claude, no claude CLI",
    r.code === 0 && ["hivemind", "hivemind-review"].every((s) => fs.lstatSync(link(s)).isSymbolicLink() && fs.realpathSync(link(s)) === fs.realpathSync(path.join(ROOT, "skills", s))) &&
    fs.readdirSync(path.join(XC, "agents")).filter((f) => f.endsWith(".toml")).length === shipped.length &&
    fs.readdirSync(path.join(XH, ".claude")).join() === "hivemind.json" && clog().length === calls, r.out + r.err);
  ok("codex install: harness recorded, context-mode MCP command suggested, no Claude-only steps",
    JSON.stringify(cjson(XH, "hivemind.json").harnesses) === '["codex"]' && r.out.includes("codex mcp add context-mode --env CONTEXT_MODE_PLATFORM=codex -- npx -y context-mode") &&
    !/AGENT_TEAMS|attribution|trust it/.test(r.out), r.out);
  const AW = path.join(XC, "agents", "hive-worker.toml"), AG = path.join(XC, "agents", "hive-guide.toml"), AS2 = path.join(XC, "agents", "hive-scout.toml"), AO = path.join(XC, "agents", "other.toml");
  const old = new Date(Date.now() - 60e3); fs.utimesSync(AW, old, old);
  fs.writeFileSync(AG, 'name = "hive-guide"\ndeveloper_instructions = "mine"\n');
  fs.writeFileSync(AS2, '# generated by hivemind from hive-scout.md; edits are overwritten\nname = "stale"\n');
  fs.writeFileSync(AO, 'name = "other"\n');
  fs.writeFileSync(path.join(XC, "config.toml"), '[mcp_servers.context-mode]\ncommand = "npx"\n');
  r = run(INST, "", { args: ["--harness=codex"], cwd: CWD, env: xenv() });
  ok("codex re-install: unchanged agent not rewritten, stale generated one refreshed, one without the header kept and reported",
    r.code === 0 && fs.statSync(AW).mtimeMs < Date.now() - 30e3 && /^name = "hive-scout"$/m.test(fs.readFileSync(AS2, "utf8")) && fs.readFileSync(AG, "utf8").includes("mine") &&
    fs.existsSync(AO) && r.out.includes(`local override kept: ${AG}`) && !/context-mode|Once, in Codex/.test(r.out), r.out + r.err);
  const BH = chome("both");
  run(INST, "", { cwd: CWD, env: cenv(BH) });
  const noKey = !("harnesses" in cjson(BH, "hivemind.json"));
  run(INST, "", { args: ["--harness", "codex"], cwd: CWD, env: cenv(BH, { CODEX_HOME: path.join(BH, ".codex") }) });
  ok("codex install: a claude-only install writes no harnesses key; adding codex records both", noKey && JSON.stringify(cjson(BH, "hivemind.json").harnesses) === '["claude","codex"]', JSON.stringify(cjson(BH, "hivemind.json")));
  ok("codex flags: unknown or missing harness and --confine with codex exit 2; HIVE_HARNESS=codex selects it",
    run(INST, "", { args: ["--harness", "cursor"], cwd: CWD, env: xenv() }).code === 2 && run(INST, "", { args: ["--harness"], cwd: CWD, env: xenv() }).code === 2 &&
    run(INST, "", { args: ["--harness", "codex", "--project", "--confine"], cwd: CWD, env: xenv() }).code === 2 &&
    /^ok   ~\/\.agents\/skills link/m.test(run(INST, "", { args: ["--doctor"], cwd: CWD, env: xenv({ HIVE_HARNESS: "codex" }) }).out));

  // --project: a repo copy of the skill is a duplicate; the lead's files are machine-local
  const XP = path.join(W, "cx-proj");
  g(W, "init", "-q", "-b", "main", XP);
  fs.mkdirSync(path.join(XP, ".agents", "skills", "hivemind"), { recursive: true });
  fs.writeFileSync(path.join(XP, ".agents", "skills", "hivemind", "SKILL.md"), "---\nname: hivemind\n---\nold copy\n");
  fs.writeFileSync(path.join(XP, "README.md"), "x\n"); g(XP, "add", "README.md"); g(XP, "commit", "-qm", "init");
  r = run(INST, "", { args: ["--project", "--harness", "codex"], cwd: XP, env: xenv() });
  const xhj = JSON.parse(fs.readFileSync(path.join(XP, ".codex", "hooks.json"), "utf8"));
  const excl = fs.readFileSync(path.join(XP, ".git", "info", "exclude"), "utf8").split("\n");
  ok("codex --project: hooks in .codex/hooks.json, rules, repo skill copy removed, machine-local files excluded, only teams/ untracked",
    r.code === 0 && /hive-lead-guard\.js/.test(JSON.stringify(xhj.hooks.PreToolUse)) && fs.existsSync(path.join(XP, ".codex", "rules", "hivemind.rules")) &&
    !fs.existsSync(path.join(XP, ".agents", "skills", "hivemind")) && /removed  \.agents\/skills\/hivemind /.test(r.out) && !fs.existsSync(path.join(XP, ".claude", "settings.local.json")) &&
    [".codex/hooks.json", ".codex/hooks/hive-*.js", ".codex/rules/hivemind.rules", ".codex/hive-owned"].every((l) => excl.includes(l)) && g(XP, "status", "--porcelain") === "?? teams/",
    r.out + r.err + g(XP, "status", "--porcelain"));
  ok("codex --project: prints the one-time trust and /hooks steps (context-mode already on)",
    /Once, in Codex:\n  1\. open codex in this repo and trust it.*\n  2\. approve the hivemind hooks in \/hooks/.test(r.out) && !/codex mcp add/.test(r.out), r.out);

  const xdoc = (...a) => run(INST, "", { args: ["--harness", "codex", "--doctor", ...a], cwd: XP, env: xenv() }).out;
  let d = xdoc();
  ok("codex doctor: skills, agents, hooks, rules ok; untrusted project and the header-less agent WARN; no Claude-only checks",
    /^ok   ~\/\.agents\/skills link/m.test(d) && /^ok   codex agents current$/m.test(d) && /^ok   lead hooks registered$/m.test(d) && /^ok   \.codex\/rules\/hivemind\.rules$/m.test(d) &&
    /^ok   context-mode MCP server$/m.test(d) && /^WARN project not trusted in codex/m.test(d) && /^WARN codex agents not generated by hivemind, left alone: .*hive-guide\.toml/m.test(d) &&
    !/AGENT_TEAMS|mattpocock|attribution|\.claude\/skills/.test(d), d);
  fs.writeFileSync(path.join(XC, "config.toml"), `[projects."${XP}"]\ntrust_level = "trusted"\n`);
  fs.rmSync(path.join(XP, ".codex", "rules"), { recursive: true }); fs.rmSync(path.join(XP, ".codex", "hooks", "hive-lead-guard.js")); fs.unlinkSync(link("hivemind"));
  d = xdoc();
  ok("codex doctor: broken pieces FIX, a missing context-mode MCP server WARNs with the codex mcp add command",
    /^FIX  ~\/\.agents\/skills\/\{hivemind\} not linked/m.test(d) && /^FIX  lead hooks not registered: hive-lead-guard\.js/m.test(d) && /^FIX  \.codex\/rules\/hivemind\.rules missing/m.test(d) &&
    /^WARN context-mode MCP server \(required\) missing .* — codex mcp add context-mode /m.test(d) && /^ok   project trusted in codex$/m.test(d), d);
  d = xdoc("--fix");
  ok("codex doctor --fix: relinks, re-registers, rewrites the rules; the header-less agent stays",
    /^ok   ~\/\.agents\/skills link .*\(fixed\)$/m.test(d) && /^ok   lead hooks registered \(fixed\)$/m.test(d) && /^ok   \.codex\/rules\/hivemind\.rules( \(fixed\))?$/m.test(d) && fs.existsSync(path.join(XP, ".codex", "rules", "hivemind.rules")) &&
    fs.readFileSync(AG, "utf8").includes("mine"), d.replace(/\n/g, " / "));

  // --update reinstalls every recorded harness, with --project for each whose hooks the repo has
  const XB = path.join(W, "xupd.git"), XA = path.join(W, "xupd-a"), XU = path.join(W, "xupd-c");
  g(W, "init", "-q", "--bare", "-b", "main", XB); g(W, "clone", "-q", XB, XA);
  for (const f of execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { cwd: ROOT, encoding: "utf8" }).split("\n").filter((f) => f && fs.existsSync(path.join(ROOT, f)))) {
    fs.mkdirSync(path.dirname(path.join(XA, f)), { recursive: true }); fs.copyFileSync(path.join(ROOT, f), path.join(XA, f));
  }
  g(XA, "add", "-A"); g(XA, "commit", "-qm", "chore: snapshot"); g(XA, "push", "-q", "-u", "origin", "HEAD:main");
  g(W, "clone", "-q", XB, XU);
  const UX = chome("xupd");
  fs.writeFileSync(path.join(UX, ".claude", "hivemind.json"), JSON.stringify({ home: XU, autoUpdate: false, harnesses: ["claude", "codex"] }));
  r = run(path.join(XU, "install.js"), "", { args: ["--update"], cwd: XP, env: cenv(UX, { CODEX_HOME: path.join(UX, ".codex") }) });
  ok("--update: both recorded harnesses reinstalled, --project only for codex (the repo's hooks are Codex's)",
    r.code === 0 && r.out.includes(path.join(UX, ".claude", "skills", "{hivemind,hivemind-review}")) && r.out.includes(path.join(UX, ".agents", "skills", "{hivemind,hivemind-review}")) &&
    /lead     -> \.codex\/hooks\.json/.test(r.out) && !/settings\.local\.json/.test(r.out) && !fs.existsSync(path.join(XP, ".claude")), r.out + r.err);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
const med = (a) => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];
console.log("median ms: " + Object.entries(timings).map(([k, v]) => `${k}=${med(v).toFixed(0)}`).join(" ") + ` statusline(warm)=${med(slTimes).toFixed(0)}`);
