#!/usr/bin/env node
// Run from a repo root by the installer: node <checkout>/templates/hooks/install-lead-hooks.js
// Copies every file beside it (except itself) into .claude/hooks/, so the lead can run
// hive-worktree.js and hive-status.js from there, and registers the lead's hooks in
// .claude/settings.local.json (machine-local and untracked, so worktrees never inherit it).
// Idempotent: an entry whose command already names the script is left alone, other hooks are
// never touched, an old narrower hive-lead-guard matcher is widened. Invalid JSON → exit 1.
"use strict";
const fs = require("fs");
const path = require("path");
const lib = require(path.join(__dirname, "hive-lib.js"));

const hooksDir = path.join(".claude", "hooks");
const self = path.basename(__filename);
fs.mkdirSync(hooksDir, { recursive: true });
let copied = 0;
for (const f of fs.readdirSync(__dirname)) {
  if (f === self || !fs.statSync(path.join(__dirname, f)).isFile()) continue;
  if (lib.syncFile(path.join(__dirname, f), path.join(hooksDir, f))) copied++;
}

const file = path.join(".claude", "settings.local.json");
const r = lib.registerLeadHooks(file);
if (r.error) {
  console.error(`warning: ${r.error}; hooks not registered. Fix the file and re-run.`);
  process.exitCode = 1;
  return;
}
console.log(`lead     -> ${file} (${r.changed ? "hooks registered" : "hooks already registered"}, ${copied} files updated; HIVEMIND=0 claude skips them)`);
