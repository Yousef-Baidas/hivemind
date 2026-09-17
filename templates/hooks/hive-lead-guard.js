#!/usr/bin/env node
// Claude Code PreToolUse hook for the lead's session (main checkout, main thread).
// 1. The lead writes no code: Edit/Write inside the repo is refused except the docs it owns.
// 2. Only Sonnet and Opus write or review code: an Agent call naming haiku or fable,
//    or a non-hive agent with no model (it would inherit the lead's), is refused.
// Subagents (agent_id set), linked worktrees, and HIVEMIND=0 sessions pass untouched.
// Exit 2 = block; the message on stderr reaches the lead as the tool's error.
"use strict";
const fs = require("fs");
const path = require("path");

if (process.env.HIVEMIND === "0") process.exit(0);
const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();

// docs the lead may write: the three repo docs, ADRs, nothing else
const LEAD_MAY_WRITE = [/^CONTEXT\.md$/, /^CONVENTIONS\.md$/, /^AGENTS\.md$/, /^CLAUDE\.md$/, /^docs\/adr\/[^/]+\.md$/];

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (input += c));
process.stdin.on("end", () => {
  let ev;
  try { ev = JSON.parse(input); } catch { process.exit(0); }
  if (ev.agent_id) process.exit(0);
  try { if (fs.statSync(path.join(root, ".git")).isFile()) process.exit(0); } catch {}

  const tool = ev.tool_name || "";
  const ti = ev.tool_input || {};

  if (tool === "Agent" || tool === "Task") {
    const model = String(ti.model || "").toLowerCase();
    const type = String(ti.subagent_type || "");
    if (/haiku|fable|mythos/.test(model)) deny(`model "${ti.model}" may not write or review code. Use sonnet (standard) or opus (hard, verify).`);
    if (!model && !type.startsWith("hive-")) deny(`agent "${type || "default"}" with no model inherits the lead's. Pass model: "sonnet" or "opus".`);
    process.exit(0);
  }

  const target = ti.file_path || ti.notebook_path;
  if (!target) process.exit(0);
  const rel = path.relative(root, path.resolve(root, target)).split(path.sep).join("/");
  if (rel.startsWith("..")) process.exit(0); // outside the repo: temp issue bodies, memory
  if (LEAD_MAY_WRITE.some((re) => re.test(rel))) process.exit(0);
  deny(`the lead does not edit ${rel}. Decide the fix, then dispatch it to a hive-<profile>-worker (sonnet or opus).`);
});

function deny(why) {
  process.stderr.write(`hivemind: ${why} HIVEMIND=0 claude opens a session without this guard.\n`);
  process.exit(2);
}
