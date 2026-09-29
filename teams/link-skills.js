#!/usr/bin/env node
// Link each profile's skills into teams/<profile>/.claude/skills/.
// Run from the repo root. Copied here by hivemind's install.js --project
// (link-skills.sh and link-skills.ps1 are thin wrappers); hive-scout re-runs it after
// rewriting a skills.txt.
//
//   node teams/link-skills.js              link what is already on this machine
//   node teams/link-skills.js --install    also `npx skills add` anything missing
//   node teams/link-skills.js --confine    also drop ~/.claude/skills/<name> links
//                                          so the lead never loads them
//   node teams/link-skills.js --relock     accept current hashes into teams/skills-lock.json
//
// skills.txt line format:  <owner/repo> <skill-name>
// required.txt (same format) holds the pipeline's mandatory skills; hive-scout never
// rewrites it and it does not count against the eight-per-profile cap.
// teams/skills-lock.json pins each linked skill's content hash (sha256 over its files);
// a differing hash on this machine prints "drift: <skill>" and keeps the committed hash.
// Links are symlinks, junctions on Windows (no admin needed); removing one never touches
// its target. install.js requires this file for the same link helpers.
"use strict";
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const WIN = process.platform === "win32";
const HOME = os.homedir();
// hivemind's own global links; never confined
const OURS = new Set(["hivemind", "hivemind-review"]);

function lstat(p) { try { return fs.lstatSync(p); } catch { return null; } }
function real(p) { try { return fs.realpathSync(p); } catch { return null; } }
function isDir(p) { try { return fs.statSync(p).isDirectory(); } catch { return false; } }
function isFile(p) { try { return fs.statSync(p).isFile(); } catch { return false; } }
function samePath(a, b) { return !!a && !!b && (WIN ? a.toLowerCase() === b.toLowerCase() : a === b); }

// Remove a symlink or junction, never what it points to. Works on broken links too.
function removeLink(link) {
  const st = lstat(link);
  if (!st) return false;
  if (!st.isSymbolicLink()) throw new Error(`${link} is not a link; left alone`);
  try { fs.unlinkSync(link); }
  catch (e) {
    if (e.code !== "EPERM" && e.code !== "EISDIR") throw e;
    fs.rmdirSync(link); // non-recursive: removes a junction, refuses a real directory
  }
  return true;
}

// Point link at the directory target. False if a real file or directory is in the way.
function linkDir(target, link) {
  const st = lstat(link);
  if (st && !st.isSymbolicLink()) return false;
  if (st) {
    if (samePath(real(link), real(target))) return true;
    removeLink(link);
  }
  fs.mkdirSync(path.dirname(link), { recursive: true });
  fs.symlinkSync(target, link, WIN ? "junction" : "dir");
  return true;
}

function findSrc(name) {
  for (const cand of [path.join(HOME, ".agents", "skills", name), path.join(HOME, ".claude", "skills", name)]) {
    if (isDir(cand)) return real(cand);
  }
  return null;
}

// [[source, name], ...] from a list file; blank lines and # comments skipped, CRLF tolerated
function readList(file) {
  return fs.readFileSync(file, "utf8").split(/\r?\n/)
    .map((l) => l.trim().split(/\s+/))
    .filter(([source]) => source && !source.startsWith("#"));
}

function listFiles(dir) {
  return ["required.txt", "skills.txt"].map((f) => path.join(dir, f)).filter(isFile);
}

// sha256 over relative path + content of every file; must stay byte-identical to the
// original link-skills.sh hash or every existing lock reports drift
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
  e.name === "node_modules" || e.name === ".git" ? [] : e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
function hashDir(d) {
  const h = crypto.createHash("sha256");
  for (const f of walk(d).sort()) {
    h.update(path.relative(d, f).split(path.sep).join("/") + "\0");
    h.update(fs.readFileSync(f));
    h.update("\0");
  }
  return h.digest("hex");
}

function profiles(teams) {
  return fs.readdirSync(teams).filter((p) => isDir(path.join(teams, p))).sort();
}

function run({ root = process.cwd(), install = false, confine = false, relock = false, log = console.log } = {}) {
  const teams = path.join(root, "teams");
  if (!isDir(teams)) throw new Error("no teams/ here; run from the repo root");
  const missing = [];
  const linked = [];
  for (const p of profiles(teams)) {
    const dir = path.join(teams, p);
    const lists = listFiles(dir);
    if (!lists.length) continue;
    const skillsDir = path.join(dir, ".claude", "skills");
    fs.mkdirSync(skillsDir, { recursive: true });
    let n = 0;
    for (const [source, name] of lists.flatMap(readList)) {
      if (!name) { console.error(`teams/${p}: line needs '<owner/repo> <skill>': ${source}`); continue; }
      let src = findSrc(name);
      if (!src && install) {
        spawnSync(WIN ? "npx.cmd" : "npx", ["-y", "skills", "add", source, "--skill", name, "-g", "-y", "-a", "claude-code"],
          { stdio: "ignore", shell: WIN });
        src = findSrc(name);
      }
      if (!src) { missing.push(`${p}: npx skills add ${source} --skill ${name} -g -y`); continue; }
      if (!linkDir(src, path.join(skillsDir, name))) {
        console.error(`teams/${p}/.claude/skills/${name} is a real directory, not a link; left alone`);
        continue;
      }
      n++;
      linked.push({ name, source, src });
      const g = path.join(HOME, ".claude", "skills", name);
      if (confine && !OURS.has(name) && lstat(g) && lstat(g).isSymbolicLink()) removeLink(g);
    }
    log(`teams/${p} -> ${n} skills linked`);
  }

  if (missing.length) {
    log("");
    log("missing; install then re-run (or pass --install):");
    for (const m of missing) log(`  ${m}`);
  }
  if (confine) log("confined: linked skills removed from ~/.claude/skills (restart Claude Code)");

  // lock
  if (linked.length) {
    const lockFile = path.join(teams, "skills-lock.json");
    let lock = { version: 1, skills: {} };
    let before = "";
    try { before = fs.readFileSync(lockFile, "utf8"); lock = JSON.parse(before); } catch {}
    const drift = [];
    for (const { name, source, src } of linked) {
      const h = hashDir(src);
      const old = lock.skills[name];
      if (old && old.hash !== h && !relock) { drift.push(name); continue; }
      lock.skills[name] = { source, hash: h };
    }
    const after = JSON.stringify(lock, null, 2) + "\n";
    if (after !== before) fs.writeFileSync(lockFile, after);
    for (const d of drift) log(`drift: ${d}  (npx skills update ${d}, or --relock to accept)`);
    log(`lock -> teams/skills-lock.json (${Object.keys(lock.skills).length} skills${relock ? ", relocked" : ""})`);
  }
  return { linked: linked.length, missing: missing.length };
}

module.exports = { WIN, lstat, real, isDir, isFile, samePath, removeLink, linkDir, readList, listFiles, profiles, hashDir, run };

if (require.main === module) {
  const opt = {};
  for (const a of process.argv.slice(2)) {
    if (a === "--install") opt.install = true;
    else if (a === "--confine") opt.confine = true;
    else if (a === "--relock") opt.relock = true;
    else { console.error(`unknown flag: ${a}`); process.exit(2); }
  }
  try { run(opt); }
  catch (e) { console.error(e.message); process.exit(1); }
}
