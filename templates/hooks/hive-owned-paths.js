#!/usr/bin/env node
// Claude Code PreToolUse hook: block Edit/Write/MultiEdit outside the ticket's owned paths.
// The lead writes one path or glob per line to <worktree>/.claude/hive-owned before dispatch.
// No file → hook allows everything (the lead's own session, verifiers, bootstrap).
// The rule itself lives in hive-lib (ownedDenial), shared with the lead guard's subagent check.
// Exit 2 = block; the message on stderr reaches the agent as the tool's error.
"use strict";
const fs = require("fs");
const path = require("path");

const root = path.resolve(process.env.CLAUDE_PROJECT_DIR || process.cwd());
if (!fs.existsSync(path.join(root, ".claude", "hive-owned"))) process.exit(0);
const lib = require(path.join(__dirname, "hive-lib.js"));

lib.run((ev) => {
  const ti = ev.tool_input || {};
  const target = ti.file_path || ti.notebook_path;
  if (!target) return;
  const why = lib.ownedDenial(root, target);
  if (why) lib.deny(why);
});
