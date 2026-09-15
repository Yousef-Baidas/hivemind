#!/usr/bin/env node
// Claude Code PreToolUse hook: block Edit/Write/MultiEdit outside the ticket's owned paths.
// The lead writes one path or glob per line to <worktree>/.claude/hive-owned before dispatch.
// No file → hook allows everything (the lead's own session, verifiers, bootstrap).
// Exit 2 = block; the message on stderr reaches the agent as the tool's error.
"use strict";
const fs = require("fs");
const path = require("path");

const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const listFile = path.join(root, ".claude", "hive-owned");
if (!fs.existsSync(listFile)) process.exit(0);

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (input += c));
process.stdin.on("end", () => {
  let target;
  try { target = JSON.parse(input).tool_input?.file_path; } catch { process.exit(0); }
  if (!target) process.exit(0);

  const rel = path.relative(root, path.resolve(root, target)).split(path.sep).join("/");
  if (rel.startsWith("..")) deny(rel, "outside the worktree");

  const owned = fs.readFileSync(listFile, "utf8").split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  if (owned.some((g) => match(g, rel))) process.exit(0);
  deny(rel, "not in .claude/hive-owned");
});

function deny(rel, why) {
  process.stderr.write(`hivemind: ${rel} is ${why}. Comment "NEEDS ${rel}: <why>" on the issue and stop.\n`);
  process.exit(2);
}

// glob → regex: ** any depth, * within a segment, trailing / means the whole directory
function match(glob, rel) {
  let g = glob.replace(/\/+$/, "/**");
  const re = "^" + g.split("**").map((p) => p.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*")).join(".*") + "$";
  return new RegExp(re).test(rel);
}
