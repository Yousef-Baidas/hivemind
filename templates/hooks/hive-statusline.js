#!/usr/bin/env node
// Claude Code statusLine command: the user's own status line (from <harness home>/settings.json,
// run with the same stdin), then " · hive: N questions · M reviews" when either is above 0, and
// " · hivemind: update ready" when the autostart found the hivemind checkout behind.
// Reads only the inbox cache; a cache older than 60 s triggers one detached
// `hive-inbox.js --refresh` per 60 s (lock: <common>/hive/inbox.refresh). Never throws.
"use strict";
const fs = require("fs");
const path = require("path");
const os = require("os");

const STALE_MS = 60 * 1000;
let out = "";
let input = "";
try { input = fs.readFileSync(0, "utf8"); } catch {}

let lib = null, ad = null;
try { lib = require(path.join(__dirname, "hive-lib.js")); ad = require(path.join(__dirname, "hive-harness.js")); } catch {}

try {
  const user = JSON.parse(fs.readFileSync(path.join(ad ? ad.home : path.join(os.homedir(), ".claude"), "settings.json"), "utf8")).statusLine;
  const cmd = user && user.type === "command" && typeof user.command === "string" ? user.command : "";
  if (cmd && !cmd.includes("hive-statusline.js")) {
    // a statusLine command is a shell string by definition, so it runs through the shell
    out = require("child_process").execSync(cmd, { input, encoding: "utf8", timeout: 5000, windowsHide: true, stdio: ["pipe", "pipe", "ignore"] }).replace(/\s+$/, "");
  }
} catch {}

try {
  let ev = {};
  try { ev = JSON.parse(input) || {}; } catch {}
  const here = path.resolve(__dirname, "..", "..");
  const common = lib.gitCommonDir(here) || lib.gitCommonDir((ev.workspace && ev.workspace.project_dir) || ev.cwd || process.cwd());
  if (common) {
    const hive = lib.hiveDir(common);
    const cache = lib.inboxFile(common);
    let age = Infinity;
    try { age = Date.now() - fs.statSync(cache).mtimeMs; } catch {}
    if (age > STALE_MS) refresh(hive);
    const inbox = lib.readInbox(common);
    const q = inbox ? inbox.questions.length : 0;
    const r = inbox ? inbox.reviews.length : 0;
    if (q || r) out += `${out ? " · " : ""}hive: ${q} question${q === 1 ? "" : "s"} · ${r} review${r === 1 ? "" : "s"}`;
  }
} catch {}

// the hivemind checkout is behind its upstream (counted by the autostart); shown until --update
try {
  const b = (JSON.parse(fs.readFileSync(lib.configFile(), "utf8")) || {}).behind;
  if (b > 0) out += `${out ? " · " : ""}hivemind: update ready (install.js --update)`;
} catch {}

process.stdout.write(out + "\n");

function refresh(hive) {
  const lock = path.join(hive, "inbox.refresh");
  try { if (Date.now() - fs.statSync(lock).mtimeMs < STALE_MS) return; } catch {}
  try {
    fs.mkdirSync(hive, { recursive: true });
    fs.writeFileSync(lock, String(Date.now()));
    const c = require("child_process").spawn(process.execPath, [path.join(__dirname, "hive-inbox.js"), "--refresh"], { detached: true, stdio: "ignore", windowsHide: true, cwd: path.resolve(__dirname, "..", "..") });
    c.on("error", () => {});
    c.unref();
  } catch {}
}
