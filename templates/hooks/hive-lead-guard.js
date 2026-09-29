#!/usr/bin/env node
// Claude Code PreToolUse hook for the lead's session (main checkout).
// Main thread:
// 1. The lead writes no code: Edit/Write inside the repo is refused except the docs it owns.
// 2. Only Sonnet and Opus write or review code: an Agent call naming haiku or fable,
//    or a non-hive agent with no model (it would inherit the lead's), is refused.
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
    const model = String(ti.model || "").toLowerCase();
    const type = String(ti.subagent_type || "");
    if (/haiku|fable|mythos/.test(model)) lib.deny(`model "${ti.model}" may not write or review code. Use sonnet (standard) or opus (hard, verify).` + BYPASS);
    if (!model && !type.startsWith("hive-")) lib.deny(`agent "${type || "default"}" with no model inherits the lead's. Pass model: "sonnet" or "opus".` + BYPASS);
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
  lib.deny(`the lead does not edit ${rel}. Decide the fix, then dispatch it to a hive-<profile>-worker (sonnet or opus).` + BYPASS);
});

// the escape hatch: the human's latest prompt names the file; any doubt denies
function humanNamed(ev, target) {
  try {
    const prompt = lib.lastHumanPrompt(ev);
    return !!prompt && prompt.includes(path.basename(String(target).replace(/\\/g, "/")));
  } catch { return false; }
}

function denyImage(target) {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny",
    permissionDecisionReason: `hivemind: the lead does not open images (each costs ~1.5k tokens of lead context). Spawn a Sonnet subagent: "Read ${target}; answer in 5 lines: <what to check>", or post the path on the review issue for the human. HIVEMIND=0 claude skips this guard.` } }));
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
