#!/usr/bin/env node
// Run from a repo root by the installer: node <checkout>/templates/hooks/install-lead-hooks.js
// Copies every file beside it (except itself and the adapter's skipHooks, which it removes if an
// older install left them) into the harness's hooks dir (.claude/hooks/), so the lead can run
// proteus-worktree.js and proteus-status.js from there, and registers the lead's hooks
// (Claude Code: .claude/settings.local.json, machine-local and untracked, so worktrees never inherit it).
// Idempotent: an entry whose command already names the script is left alone, other hooks are
// never touched, an old narrower proteus-lead-guard matcher is widened. Invalid JSON → exit 1.
// Every delete goes through safeUnlink: a regular file whose real parent is exactly the real hooksDir
// (.claude/hooks, or .codex/hooks for Codex), nothing else (#13). PROTEUS_KEEP_SKIPPED=1 (set by
// install.js, which removes those copies through its own guard first) skips the removal entirely.
"use strict";
const fs = require("fs");
const path = require("path");
const lib = require(path.join(__dirname, "proteus-lib.js"));
const ad = require(path.join(__dirname, "proteus-harness.js"));

const hooksDir = ad.hooksDir(".");
const self = path.basename(__filename);
const skip = new Set(ad.skipHooks || []);
const keepSkipped = process.env.PROTEUS_KEEP_SKIPPED === "1";
const same = (a, b) => (process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b);

// true if the file p was removed; false if absent, not a regular file, or not directly in hooksDir
function safeUnlink(p) {
  try {
    if (!fs.lstatSync(p).isFile()) return false;
    if (!same(fs.realpathSync(path.dirname(path.resolve(p))), fs.realpathSync(hooksDir))) {
      console.error(`refused  ${p} (not directly in ${hooksDir}; left alone)`);
      return false;
    }
    fs.unlinkSync(p);
    return true;
  } catch { return false; }
}

fs.mkdirSync(hooksDir, { recursive: true });
let copied = 0, removed = 0;
for (const f of fs.readdirSync(__dirname)) {
  if (f === self || !fs.statSync(path.join(__dirname, f)).isFile()) continue;
  const dest = path.join(hooksDir, f);
  if (!skip.has(f)) { if (lib.syncFile(path.join(__dirname, f), dest)) copied++; continue; }
  // hooksDir is machine-local and git-excluded: a copy there is an older install's, not the user's
  if (!keepSkipped && safeUnlink(dest)) removed++;
}

const r = ad.registerLead(".");
const file = r.file;
if (r.error) {
  console.error(`warning: ${r.error}; hooks not registered. Fix the file and re-run.`);
  process.exitCode = 1;
  return;
}
console.log(`lead     -> ${file} (${r.changed ? "hooks registered" : "hooks already registered"}, ${copied} files updated${removed ? `, ${removed} unused removed` : ""}; ${ad.bypass} skips them)`);
