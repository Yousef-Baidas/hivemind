#!/usr/bin/env node
// Claude Code SessionStart hook: start every session in a hivemind repo as the lead,
// as if the human had typed /hivemind. Prints the skill body plus a local state line
// so the lead knows what bootstrap can skip without spending a tool call.
// Silent (no autostart) when: HIVEMIND=0, inside a subagent, or in a linked worktree
// (workers and the review session's fresh checkout are not the lead).
"use strict";
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFileSync } = require("child_process");

if (process.env.HIVEMIND === "0") process.exit(0);
const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (input += c));
process.stdin.on("end", () => {
  let ev = {};
  try { ev = JSON.parse(input); } catch {}
  if (ev.agent_id) process.exit(0);
  // linked worktree: .git is a file pointing at the main checkout
  try { if (fs.statSync(path.join(root, ".git")).isFile()) process.exit(0); } catch {}

  const skillDir = [path.join(root, ".claude", "skills", "hivemind"), path.join(os.homedir(), ".claude", "skills", "hivemind")]
    .find((d) => fs.existsSync(path.join(d, "SKILL.md")));
  if (!skillDir) process.exit(0);

  const state = localState();
  // a resumed session still has the skill in its transcript; only the state line is new
  if (ev.source === "resume") {
    process.stdout.write(`hivemind: session resumed, you are still the lead. ${state}\n`);
    process.exit(0);
  }
  const body = fs.readFileSync(path.join(skillDir, "SKILL.md"), "utf8").replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "");
  process.stdout.write(
    [
      "hivemind autostart: this repo runs on hivemind. The skill below is loaded exactly as if the human had typed /hivemind; do not wait for the command.",
      "The human's first message is the work order (or a question about the run). Void only if that message is /hivemind-review, another slash command, or says \"no hivemind\".",
      `References live in ${path.join(skillDir, "references")}/.`,
      state,
      "",
      body,
    ].join("\n")
  );
});

function localState() {
  const has = (f) => fs.existsSync(path.join(root, f));
  const read = (f) => { try { return fs.readFileSync(path.join(root, f), "utf8"); } catch { return ""; } };
  const agents = read("AGENTS.md") + "\n" + read("CLAUDE.md"); // older installs keep ## Learned in CLAUDE.md
  const profiles = (() => { try { return fs.readdirSync(path.join(root, "teams"), { withFileTypes: true }).filter((e) => e.isDirectory() && fs.existsSync(path.join(root, "teams", e.name, "skills.txt"))).map((e) => e.name); } catch { return []; } })();
  const shipped = profiles.filter((p) => /shipped default/.test(read(`teams/${p}/skills.txt`).split("\n")[0]));
  const unlinked = profiles.filter((p) => { try { return fs.readdirSync(path.join(root, "teams", p, ".claude", "skills")).length === 0; } catch { return true; } });
  let runs = [];
  try {
    runs = execFileSync("git", ["-C", root, "branch", "--list", "hive/*", "--format=%(refname:short)"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
      .split("\n").filter(Boolean);
    // hive/<run>-<id> are worker branches; keep only the run branches
    runs = runs.filter((b) => !runs.some((a) => a !== b && b.startsWith(a + "-"))).slice(0, 10);
  } catch {}
  const yn = (b) => (b ? "yes" : "NO");
  return (
    "hive-state (local files only; tracker not queried): " +
    [
      `CONTEXT.md=${yn(has("CONTEXT.md"))}`,
      `CONVENTIONS.md=${yn(has("CONVENTIONS.md"))}`,
      `AGENTS.md#Learned=${yn(/^## Learned/m.test(agents))}`,
      `teams=${profiles.length ? profiles.join(",") : "NO"}`,
      `skills-unscouted=${shipped.join(",") || "none"}`,
      `skills-unlinked=${unlinked.join(",") || "none"}`,
      `skills-lock=${yn(has("teams/skills-lock.json"))}`,
      `ci-gates=${yn(has(".github/workflows/hive-gates.yml"))}`,
      `lefthook=${yn(has("lefthook.yml"))}`,
      `protection=${/protection:\s*none/.test(agents) ? "none" : "on"}`,
      `hive-branches=${runs.join(",") || "none"}`,
    ].join(" ")
  );
}
