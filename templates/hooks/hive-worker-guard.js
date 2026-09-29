#!/usr/bin/env node
// Claude Code PreToolUse hook inside a worker's worktree (registered by worktree-settings.local.json).
// Refuses background Bash, Monitor, and `gh … --edit-last`: a worker whose turn ends waiting
// on a notification never wakes, and --edit-last can overwrite another agent's comment.
// Only active when .claude/hive-owned exists (a dispatched worker's worktree).
// Exit 2 = block; the message on stderr reaches the worker as the tool's error.
"use strict";
const fs = require("fs");
const path = require("path");
const lib = require(path.join(__dirname, "hive-lib.js"));

if (process.env.HIVEMIND === "0") process.exit(0);

lib.run((ev) => {
  if (!fs.existsSync(path.join(lib.projectRoot(ev), ".claude", "hive-owned"))) return;
  const why = lib.workerDenial(ev.tool_name, ev.tool_input);
  if (why) lib.deny(why);
});
