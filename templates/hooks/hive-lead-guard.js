#!/usr/bin/env node
// Claude Code PreToolUse hook for the lead's session (main checkout).
// Main thread:
// 1. The lead writes no code: Edit/Write inside the repo is refused except the docs it owns.
// 2. The model ladder (hive-lib modelCaps): every Agent call names its model; one above the
//    lead's, a solo model (Fable by default: the lead is its one instance), or one under the
//    floor (Haiku by default) is refused.
// 3. Context at HIVE_HANDOFF_HARD (default 180000) or above: no new Agent spawns.
// 4. `--edit-last` is refused: every agent posts as the same GitHub account.
// 5. The lead does not Read images (renders cost ~1.5k tokens each) unless the human's
//    latest prompt names the file.
// Subagents (agent_id set; they run in the lead's process, so a worktree's own hooks may never load):
//   no background Bash, no Monitor, no --edit-last. An edit inside a checkout with .claude/hive-owned
//   must be an owned path (same rule as hive-owned-paths.js); an edit in this repo's main checkout
//   while a hive/* branch exists is refused (except the scout's teams/*/skills.txt). All else passes.
// Linked worktrees and HIVEMIND=0 sessions pass untouched.
// Exit 2 = block; the message on stderr reaches the model as the tool's error.
"use strict";
const fs = require("fs");
const path = require("path");
const lib = require(path.join(__dirname, "hive-lib.js"));

// docs the lead may write: the repo docs, ADRs, lessons, nothing else
const LEAD_MAY_WRITE = [/^CONTEXT\.md$/, /^CONVENTIONS\.md$/, /^AGENTS\.md$/, /^CLAUDE\.md$/, /^docs\/adr\/[^/]+\.md$/, /^docs\/lessons\/[^/]+\.md$/];
const EDITS = /^(Edit|Write|MultiEdit|NotebookEdit)$/;
const IMAGE = /\.(png|jpe?g|webp|gif|bmp|tiff?|exr|hdr)$/i;
const BYPASS = " HIVEMIND=0 claude opens a session without this guard.";

if (process.env.HIVEMIND === "0") process.exit(0);

lib.run((ev) => {
  const tool = ev.tool_name || "";
  const ti = ev.tool_input || {};

  if (ev.agent_id) {
    const why = lib.workerDenial(tool, ti) || (EDITS.test(tool) && subagentEdit(ev, ti));
    if (why) lib.deny(why);
    return;
  }
  // the lead's own Bash stays cheap: one regex, no fs
  if (tool === "Bash") {
    if (/--edit-last\b/.test(String(ti.command || ""))) lib.deny(lib.EDIT_LAST_MSG);
    return;
  }
  if (tool === "Monitor") return;

  const root = lib.projectRoot(ev);
  if (lib.isLinked(root)) return;

  if (tool === "Agent" || tool === "Task") {
    const why = modelDenial(lib.modelCaps(ev, root), ti.model);
    if (why) lib.deny(why + BYPASS);
    const ctx = lib.contextTokens(ev);
    if (ctx >= lib.envInt("HIVE_HANDOFF_HARD", 180000)) lib.deny(`context at ${Math.round(ctx / 1000)}k: /handoff before dispatching more.`);
    return;
  }

  const target = ti.file_path || ti.notebook_path;
  if (!target) return;
  if (tool === "Read") {
    if (IMAGE.test(target) && !humanNamed(ev, target)) denyImage(target);
    return; // lib.run exits 0 once stdout drains
  }
  const rel = lib.relPath(root, target);
  if (!rel) return; // outside the repo: temp issue bodies, memory
  if (LEAD_MAY_WRITE.some((re) => re.test(rel))) return;
  lib.deny(`the lead does not edit ${rel}. Decide the fix, then dispatch it to a hive-<profile>-worker (model per the ladder).` + BYPASS);
});

// the ladder: every spawn names its model, never above the lead's rung, never a solo model, never under the floor
function modelDenial(c, name) {
  const use = `use "${c.top}" for hard tickets and every verdict, "${c.mid}" for standard tickets and helpers`;
  if (!name) return `every Agent call names its model (the agent's default may sit above the lead's): ${use}.`;
  const r = lib.rungOf(c.ladder, name);
  if (r < 0) return `model "${name}" is not on the ladder (${c.ladder.join(" < ")}); ${use}.`;
  if (c.solo.includes(c.ladder[r])) return `${c.ladder[r]} runs once per project${c.leadRung === r ? " and the lead is it" : ""}; ${use}. The human lifts this with a \`models: solo=none\` line in AGENTS.md.`;
  if (r > c.cap) return `model "${name}" is above the lead (${c.lead || "unknown"}); nothing above ${c.top}: ${use}.`;
  if (r < c.floor) return `model "${name}" is under the floor (${c.floorName}); it does not produce or review work: ${use}.`;
  return "";
}

// the escape hatch: the human's latest prompt names the file; any doubt denies
function humanNamed(ev, target) {
  try {
    const prompt = lib.lastHumanPrompt(ev);
    return !!prompt && prompt.includes(path.basename(String(target).replace(/\\/g, "/")));
  } catch { return false; }
}

function denyImage(target) {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny",
    permissionDecisionReason: `hivemind: the lead does not open images (each costs ~1.5k tokens of lead context). Spawn a subagent on the ladder's mid model: "Read ${target}; answer in 5 lines: <what to check>", or post the path on the review issue for the human. HIVEMIND=0 claude skips this guard.` } }));
}

// a subagent's edit: owned paths in any checkout that lists them; the main checkout is off limits during a run
function subagentEdit(ev, ti) {
  const target = ti.file_path || ti.notebook_path;
  if (!target) return "";
  const cwd = path.resolve(ev.cwd || lib.projectRoot(ev));
  const abs = path.resolve(cwd, String(target));
  const wt = lib.gitRoot(path.dirname(abs));
  if (!wt) return "";
  if (fs.existsSync(path.join(wt, ".claude", "hive-owned"))) return lib.ownedDenial(wt, abs);
  if (lib.isLinked(wt)) return "";
  const common = lib.gitCommonDir(wt);
  if (!common || common !== lib.gitCommonDir(path.resolve(lib.projectRoot(ev))) || !lib.runOpen(common)) return "";
  const rel = lib.relPath(wt, abs);
  if (ev.agent_type === "hive-scout" && /^teams\/[^/]+\/skills\.txt$/.test(rel)) return "";
  const own = lib.gitRoot(cwd);
  const hint = own && own !== wt && lib.isLinked(own) && lib.gitCommonDir(own) === common
    ? `yours is ${own}: edit ${path.join(own, rel)}`
    : "none found from your cwd; comment NEEDS on the issue and stop";
  return `workers edit only inside their worktree (${hint}). ${rel} is in the main checkout while a run is open.`;
}
