#!/usr/bin/env node
// Prepare a worker's worktree before dispatch (replaces the manual mkdir/cp/printf):
//   node .claude/hooks/hive-worktree.js <worktree> <owned path or glob>...
// Copies the worker hooks into <wt>/.claude/hooks/, writes <wt>/.claude/settings.local.json
// from worktree-settings.local.json and <wt>/.claude/hive-owned (one entry per line), and keeps
// those local files out of `git add` via <git-common-dir>/info/exclude.
"use strict";
const fs = require("fs");
const path = require("path");
const lib = require(path.join(__dirname, "hive-lib.js"));

const HOOKS = ["hive-lib.js", "hive-owned-paths.js", "hive-worker-guard.js", "hive-stall.js", "hive-lessons.js", "hive-scratch.js"];
const EXCLUDE = ["/.claude/hive-owned", "/.claude/settings.local.json", "/.claude/hooks/hive-*.js"];

const [wtArg, ...owned] = process.argv.slice(2);
if (!wtArg || !owned.length) {
  console.error("usage: node hive-worktree.js <worktree> <owned path or glob>...");
  process.exitCode = 1;
  return;
}
const wt = path.resolve(wtArg);
if (!fs.existsSync(path.join(wt, ".git"))) {
  console.error(`hive-worktree: ${wt} is not a git worktree (git worktree add it first)`);
  process.exitCode = 1;
  return;
}

const hooksDir = path.join(wt, ".claude", "hooks");
fs.mkdirSync(hooksDir, { recursive: true });
for (const f of HOOKS) fs.copyFileSync(path.join(__dirname, f), path.join(hooksDir, f));
fs.copyFileSync(path.join(__dirname, "worktree-settings.local.json"), path.join(wt, ".claude", "settings.local.json"));
const entries = owned.map((p) => p.replace(/\\/g, "/").replace(/^\.\//, "")).filter(Boolean);
fs.writeFileSync(path.join(wt, ".claude", "hive-owned"), entries.join("\n") + "\n");

try {
  const common = lib.gitCommonDir(wt);
  if (common) {
    const file = path.join(common, "info", "exclude");
    let cur = "";
    try { cur = fs.readFileSync(file, "utf8"); } catch {}
    const have = new Set(cur.split(/\r?\n/));
    const add = EXCLUDE.filter((l) => !have.has(l));
    if (add.length) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.appendFileSync(file, (cur && !cur.endsWith("\n") ? "\n" : "") + "# hivemind: machine-local worker files\n" + add.join("\n") + "\n");
    }
  }
} catch {}

console.log(`worktree ${wt}: hooks + ${entries.length} owned paths`);
