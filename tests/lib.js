"use strict";
// Shared harness for tests/*.test.js: assertions, a per-file temp dir, fake gh, spawn helpers.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync, execFileSync } = require("child_process");

let pass = 0, fail = 0;
let W, HOME, BIN, ENV;

function need() {
  if (!W) throw new Error("call workdir(name) first");
}

function workdir(name) {
  W = path.join(os.tmpdir(), "proteus-test", name);
  fs.rmSync(W, { recursive: true, force: true });
  fs.mkdirSync(W, { recursive: true });
  HOME = path.join(W, "home");
  BIN = path.join(W, "bin");
  fs.mkdirSync(path.join(HOME, ".claude"), { recursive: true });
  fs.mkdirSync(BIN);
  fs.copyFileSync(path.join(__dirname, "fakegh.js"), path.join(BIN, "gh"));
  fs.chmodSync(path.join(BIN, "gh"), 0o755);
  ENV = { PATH: `${BIN}:/usr/bin:/bin`, HOME, GIT_CONFIG_GLOBAL: "/dev/null", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
  return W;
}

function ok(name, cond, extra) {
  if (cond) pass++; else { fail++; console.log(`FAIL ${name}${extra ? " :: " + String(extra).slice(0, 600) : ""}`); }
}

function run(script, input, { cwd = process.cwd(), env = {}, args = [] } = {}) {
  need();
  const t = process.hrtime.bigint();
  const r = spawnSync(process.execPath, [script, ...args], { cwd, input: typeof input === "string" ? input : JSON.stringify(input || {}), env: { ...ENV, CLAUDE_PROJECT_DIR: cwd, ...env }, encoding: "utf8" });
  return { code: r.status, out: r.stdout, err: r.stderr, ms: Number(process.hrtime.bigint() - t) / 1e6 };
}

function g(cwd, ...args) {
  need();
  return execFileSync("git", args, { cwd, env: ENV, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function summary() {
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
}

module.exports = {
  ok, run, g, workdir, summary,
  get ENV() { need(); return ENV; },
  get BIN() { need(); return BIN; },
  get HOME() { need(); return HOME; },
  get W() { need(); return W; },
};
