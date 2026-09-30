// Check ci-shape (#36): .github/workflows/ci.yml and templates/ci/proteus-gates.yml read as text, no YAML library.
// PROTEUS_CI_YML and PROTEUS_GATES_YML override the two paths, for tests only (to prove a broken copy goes red).
// Exit 0 if every assertion passed, 1 otherwise; the first line lists each file opened with its byte size.
"use strict";
const fs = require("fs");
const path = require("path");
const { ok, summary } = require(path.join(__dirname, "lib.js"));

const ROOT = path.join(__dirname, "..");
const FILES = [
  { name: "ci.yml", file: process.env.PROTEUS_CI_YML || path.join(ROOT, ".github", "workflows", "ci.yml"), ci: true },
  { name: "proteus-gates.yml", file: process.env.PROTEUS_GATES_YML || path.join(ROOT, "templates", "ci", "proteus-gates.yml"), ci: false },
];
const size = (f) => { try { return `${fs.statSync(f).size} bytes`; } catch { return "missing"; } };
console.log(`${FILES.map((f) => `${f.file}: ${size(f.file)}`).join("; ")} (${FILES.length} files)`);

const indent = (l) => l.length - l.trimStart().length;
const comment = (l) => l.trimStart().startsWith("#");
const unquote = (s) => s.trim().replace(/^["']|["']$/g, "");

// the lines under a key at column col: every following line that is blank or indented deeper
function block(lines, i, col) {
  const out = [];
  for (let j = i + 1; j < lines.length && (lines[j].trim() === "" || indent(lines[j]) > col); j++) out.push({ n: j + 1, text: lines[j] });
  return out;
}

// every run: value with its line numbers, inline or block scalar
function runs(lines) {
  const out = [];
  lines.forEach((l, i) => {
    const m = /^(\s*(?:-\s+)?)run:(.*)$/.exec(l);
    if (!m || comment(l)) return;
    out.push({ n: i + 1, text: m[2] }, ...block(lines, i, m[1].length));
  });
  return out;
}

// the branch list of a trigger key such as push:, inline [a, b] or a - item list
function branches(lines, key) {
  const i = lines.findIndex((l) => new RegExp(`^\\s+${key}:\\s*$`).test(l));
  if (i < 0) return null;
  const body = block(lines, i, indent(lines[i]));
  const b = body.findIndex((x) => /^\s*branches:/.test(x.text));
  if (b < 0) return null;
  const inline = /branches:\s*\[(.*)\]/.exec(body[b].text);
  if (inline) return inline[1].split(",").map(unquote).filter(Boolean);
  const list = [];
  for (let j = b + 1; j < body.length && /^\s*-\s/.test(body[j].text); j++) list.push(unquote(body[j].text.replace(/^\s*-\s/, "")));
  return list;
}

for (const { name, file, ci } of FILES) {
  if (!fs.existsSync(file)) { ok(`${name} exists`, false, file); continue; }
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  const at = (xs) => xs.map((x) => `${x.n}: ${x.text.trim()}`).join(" | ");

  // 1. an expression inside run: is template-injected into the shell
  const inRun = runs(lines).filter((x) => x.text.includes("${{"));
  ok(`${name}: no \${{ expression inside any run: block`, inRun.length === 0, at(inRun));

  // 2. every action pinned to a full commit sha
  const uses = [];
  lines.forEach((l, i) => { const m = /^\s*(?:-\s+)?uses:\s*(\S+)/.exec(l); if (m && !comment(l)) uses.push({ n: i + 1, text: l, ref: unquote(m[1]) }); });
  const loose = uses.filter((u) => !/@[0-9a-f]{40}$/.test(u.ref));
  ok(`${name}: has at least one uses: step`, uses.length > 0);
  ok(`${name}: every uses: is pinned to a 40-hex commit sha`, loose.length === 0, at(loose));

  // 3. workflow-level permissions: contents: read
  const p = lines.findIndex((l) => l.startsWith("permissions:"));
  const perms = p < 0 ? "" : [lines[p], ...block(lines, p, 0).map((x) => x.text)].join("\n");
  ok(`${name}: permissions: contents: read at workflow level`, /contents:\s*read\b/.test(perms), perms || "no top-level permissions:");

  // 4. every checkout step drops the token after checkout
  const checkouts = uses.filter((u) => u.ref.startsWith("actions/checkout@"));
  const kept = checkouts.filter((u) => {
    const dash = /^(\s*)-/.exec(u.text) ? indent(u.text) : indent(u.text) - 2;
    return !block(lines, u.n - 1, dash).some((x) => /^\s*persist-credentials:\s*false\b/.test(x.text));
  });
  ok(`${name}: has an actions/checkout step`, checkouts.length > 0);
  ok(`${name}: every actions/checkout sets persist-credentials: false`, kept.length === 0, at(kept));

  if (!ci) continue;

  // 5. ci.yml only: install without lifecycle scripts, a windows job, push on main only
  const npmCi = runs(lines).filter((x) => /\bnpm ci\b/.test(x.text));
  const scripted = npmCi.filter((x) => !/\bnpm ci\b[^\n]*--ignore-scripts/.test(x.text));
  ok(`${name}: npm ci --ignore-scripts is used`, npmCi.length > 0, "no npm ci in any run:");
  ok(`${name}: every npm ci passes --ignore-scripts`, scripted.length === 0, at(scripted));
  const w = lines.findIndex((l) => /^\s{2}gates-windows:\s*$/.test(l));
  const wBody = w < 0 ? [] : block(lines, w, indent(lines[w]));
  ok(`${name}: a gates-windows job runs on windows-latest`, wBody.some((x) => /^\s*runs-on:\s*windows-latest\s*$/.test(x.text)), w < 0 ? "no gates-windows job" : at(wBody.slice(0, 3)));
  ok(`${name}: gates-windows has no continue-on-error`, !wBody.some((x) => /continue-on-error/.test(x.text)), at(wBody.filter((x) => /continue-on-error/.test(x.text))));
  const push = branches(lines, "push");
  ok(`${name}: push: lists only main`, !!push && push.length === 1 && push[0] === "main", JSON.stringify(push));
}

summary();
