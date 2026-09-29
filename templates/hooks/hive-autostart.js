#!/usr/bin/env node
// Claude Code SessionStart hook: start every session in a hivemind repo as the lead,
// as if the human had typed /hivemind. Prints the skill body plus a local state line
// so the lead knows what bootstrap can skip without spending a tool call.
// Also: syncs agents and hooks from the hivemind checkout named in ~/.claude/hivemind.json,
// checks it for updates (background fetch at most daily, fast-forward to it when autoUpdate; the
// behind-count feeds the status line), offers the tour while it is pending (tour=…), and after
// a compaction (or a startup with an open run) re-injects the run-log tail and, after a
// compaction, the human's last ten messages from the journal. Starts the scratch safety sweep
// (hive-scratch.js --sweep --stale) detached, so it never slows the start.
// Silent (no autostart) when: HIVEMIND=0, inside a subagent, or in a linked worktree
// (workers and the review session's fresh checkout are not the lead).
"use strict";
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFileSync, spawn } = require("child_process");
const lib = require(path.join(__dirname, "hive-lib.js"));

if (process.env.HIVEMIND === "0") process.exit(0);

lib.run((ev) => {
  if (ev.agent_id) return;
  const root = path.resolve(lib.projectRoot(ev));
  if (lib.isLinked(root)) return;

  const skillDir = [path.join(root, ".claude", "skills", "hivemind"), path.join(os.homedir(), ".claude", "skills", "hivemind")]
    .find((d) => fs.existsSync(path.join(d, "SKILL.md")));
  if (!skillDir) return;

  const notes = [];
  const cfg = lib.hivemindConfig();
  const home = typeof cfg.home === "string" && fs.existsSync(cfg.home) ? path.resolve(cfg.home) : null;
  let behind = 0;
  if (home) {
    behind = safe(() => update(home, cfg, notes), 0);
    safe(() => sync(home, root, notes));
  }
  const runs = hiveBranches(root);
  const src = ev.source;
  const tour = home && (src === "startup" || src === "clear") ? safe(() => tourState(home, cfg), "") : "";
  const state = localState(root, runs, home, behind) + " " + safe(() => inboxState(root), "inbox=unknown");
  if (tour) notes.push(tourOffer(tour));
  safe(() => scratchSweep(root));

  if (src === "resume" || src === "fork") {
    // a resumed session still has the skill in its transcript; only the state line is new
    process.stdout.write([`hivemind: session resumed, you are still the lead. ${state}`, ...notes].join("\n") + "\n");
    return;
  }
  const extra = [];
  if (src === "compact" || runs.length) extra.push(safe(() => runLogTail(root, runs), ""));
  if (src === "compact") extra.push(safe(() => humanSaid(root), ""));

  const body = fs.readFileSync(path.join(skillDir, "SKILL.md"), "utf8").replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "");
  process.stdout.write(
    [
      "hivemind autostart: this repo runs on hivemind. The skill below is loaded exactly as if the human had typed /hivemind; do not wait for the command.",
      "The human's first message is the work order (or a question about the run). Void only if that message is /hivemind-review, another slash command, or says \"no hivemind\".",
      `References live in ${path.join(skillDir, "references")}${path.sep}.`,
      state,
      src === "compact"
        ? "Context was just compacted. The summary above is a hint, not state: re-derive your position from the tracker (Session start 1-3, then the run-log issue) before any dispatch. Background polls and spawned agents may still be alive; check the task list before spawning a duplicate."
        : "",
      ...notes,
      ...extra.filter(Boolean),
      "",
      body,
    ].join("\n")
  );
});

function safe(fn, dflt) { try { return fn(); } catch { return dflt; } }

// background fetch at most once a day; behind-count from the already-fetched upstream ref.
// The count goes to hivemind.json for the status line, so an update shows even with autoUpdate off.
function update(home, cfg, notes) {
  const patch = {};
  const last = typeof cfg.lastFetch === "number" ? cfg.lastFetch : Date.parse(cfg.lastFetch) || 0;
  if (Date.now() - last > 24 * 3600e3) {
    try {
      const c = spawn("git", ["-C", home, "fetch", "--quiet"], { detached: true, stdio: "ignore", windowsHide: true });
      c.on("error", () => {});
      c.unref();
    } catch {}
    patch.lastFetch = Date.now();
  }
  let behind = parseInt(lib.git(["-C", home, "rev-list", "--count", "HEAD..@{u}"], home), 10) || 0;
  if (behind && cfg.autoUpdate === true) {
    try {
      const dirty = execFileSync("git", ["-C", home, "status", "--porcelain", "--untracked-files=no"], { encoding: "utf8", timeout: 3000, windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
      if (!dirty.trim()) {
        const before = lib.git(["-C", home, "rev-parse", "HEAD"], home);
        // fast-forward to the already-fetched upstream: no network wait, no race with the background fetch
        execFileSync("git", ["-C", home, "merge", "--ff-only", "--quiet", "@{u}"], { timeout: 15000, windowsHide: true, stdio: "ignore" });
        notes.push(`hivemind: updated to ${lib.git(["-C", home, "rev-parse", "--short", "HEAD"], home)}`);
        behind = 0;
        // an install from before the tour existed gets a what's-new tour from here, not a first-time one
        if (cfg.toured === undefined && before) patch.toured = before;
      }
    } catch {}
  }
  if ((cfg.behind || 0) !== behind) patch.behind = behind;
  if (Object.keys(patch).length) patchConfig(cfg, patch);
  return behind;
}

function patchConfig(cfg, patch) {
  safe(() => {
    const next = { ...lib.hivemindConfig(), ...patch };
    for (const k of Object.keys(next)) if (next[k] === undefined || (k === "behind" && !next[k])) delete next[k];
    lib.writeJSON(lib.configFile(), next);
  });
  Object.assign(cfg, patch);
}

// printed only while the tour is pending, so a toured install carries none of it
function tourOffer(tour) {
  const n = tour.split(":")[1];
  const line = n ? `hivemind has ${n} new feature${n === "1" ? "" : "s"} since your last tour: type \`tour\`, or \`tour off\`.` : "New to hivemind? Type `tour` for a short walkthrough, or `tour off`.";
  return `hivemind ${tour}: open your first reply with this one line, then carry on: "${line}" (the hook repeats the offer, you do not; \`tour\` → references/tour.md).`;
}

// the tour offer: tour=new until the first tour, tour=whats-new:N once N features landed since the
// last one. At most three session starts, then recorded as declined; nothing at all once taken.
const FEATURE = /^feat(\([^)]*\))?!?:|^\w+(\([^)]*\))?!:/;
function tourState(home, cfg) {
  let field = "tour=new";
  const head = lib.git(["-C", home, "rev-parse", "HEAD"], home);
  if (cfg.toured) {
    if (!head || head === cfg.toured) return "";
    const n = lib.git(["-C", home, "log", "--format=%s", `${cfg.toured}..HEAD`], home).split("\n").filter((l) => FEATURE.test(l)).length;
    if (!n) return "";
    field = `tour=whats-new:${n}`;
  }
  const offers = (cfg.tourOffers || 0) + 1;
  if (offers > 3) { patchConfig(cfg, { toured: head || "none", tourOffers: undefined }); return ""; }
  patchConfig(cfg, { tourOffers: offers });
  return field;
}

// agents → ~/.claude/agents, hooks → <repo>/.claude/hooks, only when bytes differ; never deletes
function sync(home, root, notes) {
  let n = 0;
  let hooks = 0;
  const ls = (d) => { try { return fs.readdirSync(d); } catch { return []; } };
  const agentsDir = path.join(os.homedir(), ".claude", "agents");
  for (const f of ls(path.join(home, "agents"))) if (f.endsWith(".md") && lib.syncFile(path.join(home, "agents", f), path.join(agentsDir, f))) n++;
  const hooksSrc = path.join(home, "templates", "hooks");
  for (const f of ls(hooksSrc)) {
    if (f === "install-lead-hooks.js") continue; // the installer runs from the source, like install-lead-hooks does
    const s = path.join(hooksSrc, f);
    if (fs.statSync(s).isFile() && lib.syncFile(s, path.join(root, ".claude", "hooks", f))) hooks++;
  }
  // a new hook file may need a new registration
  if (hooks) lib.registerLeadHooks(path.join(root, ".claude", "settings.local.json"));
  if (n + hooks) notes.push(`hivemind: synced ${n + hooks} files from ${home}`);
}

// only when the hive has scratch state; the sweep caches the size the next state line reads
function scratchSweep(root) {
  const hive = lib.hiveDir(lib.gitCommonDir(root));
  if (!fs.existsSync(path.join(hive, "scratch-ledger.jsonl")) && !fs.existsSync(path.join(hive, "scratch"))) return;
  const c = spawn(process.execPath, [path.join(__dirname, "hive-scratch.js"), "--sweep", "--stale"], { cwd: root, detached: true, stdio: "ignore", windowsHide: true });
  c.on("error", () => {});
  c.unref();
}

function hiveBranches(root) {
  const runs = lib.git(["-C", root, "branch", "--list", "hive/*", "--format=%(refname:short)"], root).split("\n").filter(Boolean);
  // hive/<run>-<id> are worker branches; keep only the run branches
  return runs.filter((b) => !runs.some((a) => a !== b && b.startsWith(a + "-"))).slice(0, 10);
}

function runLogTail(root, runs) {
  const list = JSON.parse(lib.gh(["issue", "list", "--label", "hive-log", "--state", "open", "--json", "number,title", "--limit", "5"], root) || "null");
  if (!Array.isArray(list)) return "";
  if (!list.length) return "run-log: no open issue labelled hive-log.";
  const pick = list.find((i) => runs.some((r) => String(i.title).includes(r.replace(/^hive\//, "")))) || list[0];
  const view = JSON.parse(lib.gh(["issue", "view", String(pick.number), "--json", "comments"], root) || "{}");
  const bodies = ((view && view.comments) || []).slice(-12).map((c) => String((c && c.body) || "").trim()).filter(Boolean);
  const kept = [];
  let total = 0;
  for (let i = bodies.length - 1; i >= 0; i--) {
    if (total + bodies[i].length > 3000) { if (!kept.length) kept.unshift(bodies[i].slice(-3000)); break; }
    kept.unshift(bodies[i]);
    total += bodies[i].length;
  }
  return [`run-log #${pick.number} tail (newest last):`, ...kept.map((b) => "- " + b.replace(/\n/g, "\n  "))].join("\n");
}

// open needs-human questions/reviews: the cache when under 10 min old, else a 3 s refresh
function inboxState(root) {
  const common = lib.gitCommonDir(root);
  if (!common) return "inbox=unknown";
  let age = Infinity;
  try { age = Date.now() - fs.statSync(lib.inboxFile(common)).mtimeMs; } catch {}
  const inbox = (age > 10 * 60 * 1000 && lib.refreshInbox(root, common, 3000)) || lib.readInbox(common);
  return inbox ? `inbox=${inbox.questions.length}q/${inbox.reviews.length}r` : "inbox=unknown";
}

function humanSaid(root) {
  const common = lib.gitCommonDir(root);
  if (!common) return "";
  const lines = lib.tailLines(path.join(lib.hiveDir(common), "journal.jsonl"), 512 * 1024).slice(-10);
  const said = lines.map((l) => safe(() => JSON.parse(l).prompt, "")).filter((p) => typeof p === "string" && p.trim())
    .map((p) => "- " + (p.length > 400 ? p.slice(0, 400) + "…" : p).replace(/\n/g, "\n  "));
  return said.length ? ["human said (verbatim, newest last):", ...said].join("\n") : "";
}

// the required context-mode plugin: installed and enabled at user scope (two small file reads)
function contextModeOn() {
  const id = "context-mode@context-mode";
  const dir = path.join(os.homedir(), ".claude");
  const inst = lib.readJSON(path.join(dir, "plugins", "installed_plugins.json"), {}) || {};
  const s = lib.readJSON(path.join(dir, "settings.json"), {}) || {};
  return !!(inst.plugins && Array.isArray(inst.plugins[id]) && inst.plugins[id].length && s.enabledPlugins && s.enabledPlugins[id] === true);
}

function localState(root, runs, home, behind) {
  const has = (f) => fs.existsSync(path.join(root, f));
  const read = (f) => { try { return fs.readFileSync(path.join(root, f), "utf8"); } catch { return ""; } };
  const ls = (d) => { try { return fs.readdirSync(path.join(root, d)); } catch { return []; } };
  const agents = read("AGENTS.md") + "\n" + read("CLAUDE.md"); // older installs keep ## Learned in CLAUDE.md
  const profiles = (() => { try { return fs.readdirSync(path.join(root, "teams"), { withFileTypes: true }).filter((e) => e.isDirectory() && fs.existsSync(path.join(root, "teams", e.name, "skills.txt"))).map((e) => e.name); } catch { return []; } })();
  const shipped = profiles.filter((p) => /shipped default/.test(read(`teams/${p}/skills.txt`).split("\n")[0]));
  const unlinked = profiles.filter((p) => ls(path.join("teams", p, ".claude", "skills")).length === 0);
  // root agent docs over budget, and any CLAUDE_*.md / CLAUDE-*.md split at all
  const bloat = ls(".").filter((f) => /^(CLAUDE|AGENTS).*\.md$/.test(f)).map((f) => {
    const text = read(f);
    const lines = text ? text.split("\n").length - (text.endsWith("\n") ? 1 : 0) : 0;
    return lines > 150 || /^CLAUDE[_-]/.test(f) ? `${f}:${lines}` : "";
  }).filter(Boolean);
  const lessons = ls(path.join("docs", "lessons")).filter((f) => f.endsWith(".md")).length;
  const common = lib.gitCommonDir(root);
  const scratch = common ? Math.round(((lib.readJSON(path.join(lib.hiveDir(common), "scratch-size.json"), {}) || {}).bytes || 0) / 1048576) : 0;
  const yn = (b) => (b ? "yes" : "NO");
  return (
    "hive-state (local files only; tracker not queried): " +
    [
      `CONTEXT.md=${yn(has("CONTEXT.md"))}`,
      `CONVENTIONS.md=${yn(has("CONVENTIONS.md"))}`,
      `AGENTS.md#Learned=${yn(/^## Learned/m.test(agents))}`,
      `teams=${profiles.length ? profiles.join(",") : "NO"}`,
      `skills-unscouted=${shipped.join(",") || "none"}`,
      `skills-unlinked=${unlinked.join(",") || "none"}`,
      `skills-lock=${yn(has("teams/skills-lock.json"))}`,
      `ci-gates=${yn(has(".github/workflows/hive-gates.yml"))}`,
      `lefthook=${yn(has("lefthook.yml"))}`,
      `protection=${/protection:\s*none/.test(agents) ? "none" : "on"}`,
      `hive-branches=${runs.join(",") || "none"}`,
      `doc-bloat=${bloat.join(",") || "none"}`,
      `lessons=${lessons}`,
      ...(scratch > 1024 ? [`scratch=${scratch}MB`] : []),
      ...(contextModeOn() ? [] : ["context-mode=missing"]),
      `hivemind-src=${home || "none"}`,
      ...(behind ? [`hivemind-update=${behind}-behind (node ${path.join(home, "install.js")} --update)`] : []),
    ].join(" ")
  );
}
