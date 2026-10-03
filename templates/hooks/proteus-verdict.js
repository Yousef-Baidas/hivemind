#!/usr/bin/env node
// The trusted verdict on a review or question issue: the newest comment whose first line opens with ACCEPT, CHANGES or
// ANSWER from the human's login, or AUTO-ACCEPT / AUTO-HOLD from the human's or the agents' login. Every other author is
// ignored, so a passer-by on a public repo cannot accept a milestone, and the keyword must stand alone (ACCEPTED is not ACCEPT).
//   node .claude/hooks/proteus-verdict.js <issue>          print that comment's body, or nothing
//   node .claude/hooks/proteus-verdict.js <issue> --wait   check every PROTEUS_VERDICT_POLL_S seconds (default 30) until one arrives
// The human is "human" in ~/.claude/proteus.json, else the login gh is authenticated as. When the agents post under that same
// login (identity=shared), an agent's ACCEPT counts too; the warning on stderr says so.
// Exits 0 with a verdict printed, 1 without one (gh unreachable included), 2 on bad usage.
"use strict";
const path = require("path");
const lib = require(path.join(__dirname, "proteus-lib.js"));

const HUMAN_ONLY = /^(ACCEPT|CHANGES|ANSWER)(?=\s|$)/;
const AUTO = /^(AUTO-ACCEPT|AUTO-HOLD)(?=\s|$)/;

// the newest comment a trusted author opened with a verdict keyword; null when there is none
function pick(comments, human, agent) {
  for (let i = comments.length - 1; i >= 0; i--) {
    const c = comments[i] || {};
    const who = c.author && c.author.login;
    const body = String(c.body || "").trim();
    const first = body.split(/\r?\n/, 1)[0].trim();
    if (who === human && (HUMAN_ONLY.test(first) || AUTO.test(first))) return body;
    if (who && who === agent && AUTO.test(first)) return body;
  }
  return null;
}

function main() {
  const args = process.argv.slice(2);
  const issue = args.find((a) => /^\d+$/.test(a));
  if (!issue) { console.error("usage: proteus-verdict.js <issue> [--wait]"); return 2; }
  const root = path.resolve(lib.projectRoot());
  const agent = lib.gh(["api", "user", "--jq", ".login"], root);
  const human = String(lib.proteusConfig().human || "").trim() || agent;
  if (!human) { console.error("proteus-verdict: no human login (gh not logged in, no \"human\" in ~/.claude/proteus.json)"); return 1; }
  if (human === agent) console.error(`proteus-verdict: identity=shared: agents post as ${human}, so an agent's ACCEPT would count too`);
  const pollMs = lib.envInt("PROTEUS_VERDICT_POLL_S", 30) * 1000;
  for (;;) {
    const view = JSON.parse(lib.gh(["issue", "view", issue, "--json", "comments"], root) || "null");
    const v = view && Array.isArray(view.comments) ? pick(view.comments, human, agent) : null;
    if (v) { console.log(v); return 0; }
    if (!args.includes("--wait")) return 1;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, pollMs);
  }
}

process.exitCode = main();
