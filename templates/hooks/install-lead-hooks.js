#!/usr/bin/env node
// Run from a repo root by install.sh / install.ps1 --project.
// Copies the lead's two hooks into .claude/hooks/ and registers them in
// .claude/settings.local.json (machine-local and untracked, so worktrees never inherit it).
// Idempotent: an entry whose command already names the script is left alone.
"use strict";
const fs = require("fs");
const path = require("path");

const here = __dirname;
const hooksDir = path.join(".claude", "hooks");
fs.mkdirSync(hooksDir, { recursive: true });
for (const f of ["hive-autostart.js", "hive-lead-guard.js"]) fs.copyFileSync(path.join(here, f), path.join(hooksDir, f));

const file = path.join(".claude", "settings.local.json");
let s = {};
try { s = JSON.parse(fs.readFileSync(file, "utf8")); } catch {}
s.hooks = s.hooks || {};
const cmd = (f) => `node "$CLAUDE_PROJECT_DIR/.claude/hooks/${f}"`;
const add = (event, script, matcher) => {
  const list = (s.hooks[event] = s.hooks[event] || []);
  if (JSON.stringify(list).includes(script)) return;
  const entry = { hooks: [{ type: "command", command: cmd(script) }] };
  if (matcher) entry.matcher = matcher;
  list.push(entry);
};
add("SessionStart", "hive-autostart.js");
add("PreToolUse", "hive-lead-guard.js", "Edit|Write|MultiEdit|NotebookEdit|Agent|Task");
fs.writeFileSync(file, JSON.stringify(s, null, 2) + "\n");
console.log(`lead     -> ${file} (autostart + lead guard; HIVEMIND=0 claude skips both)`);
