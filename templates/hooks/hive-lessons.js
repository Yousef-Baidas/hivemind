#!/usr/bin/env node
// Claude Code hook: trigger-based recall of <main checkout>/docs/lessons/*.md, so a solved
// problem never recurs and no session pays for lessons it does not hit.
// Lesson frontmatter: trigger (JS regex source, case-insensitive), on (command, output,
// prompt, path; default all), scope (all | lead | worker; default all).
// PreToolUse Bash → command; PreToolUse Edit/Write/Read → path; PostToolUse Bash → output;
// UserPromptSubmit → prompt. A hit injects the lesson as additionalContext, once per session
// (per subagent) per lesson, at most 2 per event; hits are counted in <common>/hive/lesson-hits.json.
// Optional laya (~/.claude/hivemind.json "laya": {"url", "threshold", "key"}): on a failure-looking
// PostToolUse Bash, one request scores up to 4 of the lessons regex missed (most-hit first); up to 2
// at P(yes) >= threshold (default 0.8) join the regex hits. 1.5 s total; any error means regex only,
// silently, and no laya for 10 min: on a CPU laya's memory grows with questions x length², and the
// server keeps computing a request the hook gave up on.
"use strict";
const fs = require("fs");
const path = require("path");
const lib = require(path.join(__dirname, "hive-lib.js"));

const KINDS = ["command", "output", "prompt", "path"];
const MAX_PER_EVENT = 2;
const MAX_CHARS = 1500;
const OUTPUT_CAP = 20 * 1024;
const LAYA_MS = 1500;
const LAYA_MAX_QUESTIONS = 4;
const LAYA_BACKOFF_MS = 10 * 60 * 1000;
const FAILURE = /\b(error|errors|failed|failure|fatal|exception|traceback|panic|cannot|can't|not found|no such file|denied|refused|timed? ?out|abort(ed)?|segmentation fault|killed|E[A-Z]{3,}\b)/i;

if (process.env.HIVEMIND === "0") process.exit(0);

lib.run(async (ev) => {
  const event = ev.hook_event_name;
  const tool = ev.tool_name || "";
  const ti = ev.tool_input || {};
  const root = lib.projectRoot(ev);
  let kind, text;
  if (event === "UserPromptSubmit") [kind, text] = ["prompt", ev.prompt];
  else if (event === "PreToolUse" && tool === "Bash") [kind, text] = ["command", ti.command];
  else if (event === "PreToolUse" && /^(Edit|Write|MultiEdit|Read|NotebookEdit)$/.test(tool)) {
    const t = ti.file_path || ti.notebook_path;
    [kind, text] = ["path", t && (lib.relPath(root, t) || String(t).split(path.sep).join("/"))];
  } else if (event === "PostToolUse" && tool === "Bash") [kind, text] = ["output", outputText(ev.tool_response)];
  else return;
  if (typeof text !== "string" || !text) return;

  const common = lib.gitCommonDir(root);
  if (!common) return;
  const dir = path.join(lib.mainRoot(common) || root, "docs", "lessons");
  let names;
  try { names = fs.readdirSync(dir).filter((f) => f.endsWith(".md")).sort(); } catch { return; }
  if (!names.length) return;

  const hive = lib.hiveDir(common);
  const scope = lib.isLead(ev, root) ? "lead" : "worker";
  const hits = [];
  const missed = [];
  for (const l of load(dir, names, hive)) {
    if (!l.on.includes(kind) || (l.scope !== "all" && l.scope !== scope)) continue;
    let re;
    try { re = new RegExp(l.trigger, "i"); } catch { missed.push(l); continue; } // a bad regex skips its lesson only
    (re.test(text) ? hits : missed).push(l);
  }

  const seenFile = path.join(hive, "lessons-seen", String(ev.session_id || "none").replace(/[^\w.-]/g, "_") + (ev.agent_id ? "-" + String(ev.agent_id).replace(/[^\w.-]/g, "_") : ""));
  const seen = new Set(read(seenFile).split("\n").filter(Boolean));
  const fresh = hits.filter((l) => !seen.has(l.file)).slice(0, MAX_PER_EVENT);
  const byLaya = kind === "output" && failed(ev.tool_response)
    ? await laya(hive, ti.command, text, missed.filter((l) => !seen.has(l.file)))
    : [];
  if (!fresh.length && !byLaya.length) return;

  if (!seen.size) prune(path.dirname(seenFile));
  fs.mkdirSync(path.dirname(seenFile), { recursive: true });
  const shown = [...fresh, ...byLaya];
  fs.appendFileSync(seenFile, shown.map((l) => l.file + "\n").join(""));
  // hits = all hits; laya = the ones only laya found, so its value can be judged at milestone close
  const countFile = path.join(hive, "lesson-hits.json");
  const counts = lib.readJSON(countFile, {}) || {};
  const now = new Date().toISOString();
  for (const l of shown) {
    const c = counts[l.file] || {};
    const via = byLaya.includes(l) ? "laya" : "regex";
    counts[l.file] = { ...c, hits: (c.hits || 0) + 1, last: now, via, ...(via === "laya" ? { laya: (c.laya || 0) + 1 } : {}) };
  }
  lib.writeJSON(countFile, counts);

  lib.additionalContext(event, shown.map((l) => {
    const body = l.body.length > MAX_CHARS ? l.body.slice(0, MAX_CHARS) + " …" : l.body;
    return `hive lesson docs/lessons/${l.file} (matched this ${byLaya.includes(l) ? "failure" : kind}):\n${body}`;
  }).join("\n\n"));
});

// a Bash result that looks like a failure: interrupted, or error words in stderr or the stdout tail
function failed(r) {
  if (!r || typeof r !== "object") return false;
  if (r.interrupted === true) return true;
  const err = typeof r.stderr === "string" ? r.stderr : "";
  const out = typeof r.stdout === "string" ? r.stdout.slice(-2000) : "";
  return FAILURE.test(err) || FAILURE.test(out);
}

// laya scores the lessons regex missed: one request, P(yes) per lesson; [] on anything unexpected
async function laya(hive, command, output, candidates) {
  const cfg = lib.hivemindConfig().laya;
  if (!cfg || typeof cfg !== "object" || typeof cfg.url !== "string" || !cfg.url) return [];
  if (!candidates.length || typeof fetch !== "function") return [];
  const backoff = path.join(hive, "laya-backoff");
  try { if (Date.now() - fs.statSync(backoff).mtimeMs < LAYA_BACKOFF_MS) return []; } catch {}
  try {
    const threshold = typeof cfg.threshold === "number" ? cfg.threshold : 0.8;
    const counts = lib.readJSON(path.join(hive, "lesson-hits.json"), {}) || {};
    const asked = [...candidates]
      .sort((a, b) => ((counts[b.file] || {}).hits || 0) - ((counts[a.file] || {}).hits || 0))
      .slice(0, LAYA_MAX_QUESTIONS);
    const questions = {};
    for (const l of asked) {
      const first = (l.body.split(/\r?\n/).find((x) => x.trim()) || l.file).trim().slice(0, 300);
      questions[l.file] = { type: "noul", instructions: `This failure matches: ${first}` };
    }
    const headers = { "content-type": "application/json" };
    if (typeof cfg.key === "string" && cfg.key) headers.authorization = `Bearer ${cfg.key}`;
    const res = await fetch(cfg.url.replace(/\/+$/, "") + "/v1/systemone", {
      method: "POST",
      headers,
      body: JSON.stringify({ state: { body: `${String(command || "").slice(0, 300)}\n${output.slice(-1000)}` }, questions }),
      signal: AbortSignal.timeout(LAYA_MS),
    });
    if (!res.ok) throw new Error(`laya ${res.status}`);
    const answers = (await res.json()).answers || {};
    return asked
      .map((l) => [l, answers[l.file] && Number(answers[l.file].noul)])
      .filter(([, p]) => p >= threshold)
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_PER_EVENT)
      .map(([l]) => l);
  } catch {
    try { fs.mkdirSync(hive, { recursive: true }); fs.writeFileSync(backoff, ""); } catch {}
    return [];
  }
}

function read(f) { try { return fs.readFileSync(f, "utf8"); } catch { return ""; } }

// stdout + stderr of a Bash result, head and tail kept when over the cap
function outputText(r) {
  const s = typeof r === "string" ? r : r && typeof r === "object" ? [r.stdout, r.stderr].filter((x) => typeof x === "string").join("\n") : "";
  return s.length > OUTPUT_CAP ? s.slice(0, OUTPUT_CAP / 2) + "\n" + s.slice(-OUTPUT_CAP / 2) : s;
}

// parsed lessons, cached in <common>/hive/lessons-cache.json keyed by the files' mtimes and sizes
function load(dir, names, hive) {
  const key = names.map((f) => { try { const st = fs.statSync(path.join(dir, f)); return `${f}:${st.mtimeMs}:${st.size}`; } catch { return f; } }).join("|");
  const cacheFile = path.join(hive, "lessons-cache.json");
  const cache = lib.readJSON(cacheFile, null);
  if (cache && cache.key === key && Array.isArray(cache.lessons)) return cache.lessons;
  const lessons = [];
  for (const f of names) {
    try {
      const l = parse(f, read(path.join(dir, f)));
      if (l) lessons.push(l);
    } catch {}
  }
  lib.writeJSON(cacheFile, { key, lessons });
  return lessons;
}

function parse(file, src) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(src);
  if (!m) return null;
  const fm = {};
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i > 0) fm[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim().replace(/^(["'])(.*)\1$/, "$2");
  }
  if (!fm.trigger) return null;
  const on = (fm.on || "").split(/[\s,]+/).map((s) => s.toLowerCase()).filter((s) => KINDS.includes(s));
  const scope = ["lead", "worker"].includes((fm.scope || "").toLowerCase()) ? fm.scope.toLowerCase() : "all";
  return { file, trigger: fm.trigger, on: on.length ? on : KINDS, scope, body: m[2].trim() };
}

// seen-sets older than a week belong to dead sessions
function prune(d) {
  try {
    const cutoff = Date.now() - 7 * 864e5;
    for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).mtimeMs < cutoff) fs.unlinkSync(p); }
  } catch {}
}
