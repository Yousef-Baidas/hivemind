#!/usr/bin/env node
// commit-msg hook: enforce references/commits.md mechanically.
// Usage: node commit-msg.js <path-to-COMMIT_EDITMSG>
"use strict";
const fs = require("fs");
const msg = fs.readFileSync(process.argv[2], "utf8");
const lines = msg.split(/\r?\n/).filter((l) => !l.startsWith("#"));
const subject = lines[0] || "";
const fail = (m) => { console.error("commit rejected: " + m); process.exit(1); };

const types = "feat|fix|refactor|test|docs|chore|perf|build|ci|style|revert";
const re = new RegExp(`^(${types})(\\([a-z0-9._/-]+\\))?!?: [A-Za-z][^\\n]*$`);
if (/^(Merge|Revert) /.test(subject)) process.exit(0);
if (!re.test(subject)) fail(`subject must be "<type>(<scope>): lowercase imperative" (types: ${types})`);
if (subject.length > 72) fail("subject over 72 chars");
if (/\.$/.test(subject)) fail("no trailing period");
if (lines[1] && lines[1].trim() !== "") fail("blank line required after subject");
for (const l of lines.slice(2)) if (l.length > 72 && !/https?:\/\//.test(l)) fail("body line over 72 chars");

const banned = /^(Co-Authored-By|Co-authored-by|Generated with|Generated-by|Assisted-by|Signed-off-by: .*\b(claude|anthropic|ai)\b|🤖)/im;
if (banned.test(msg)) fail("AI attribution trailer is not allowed");
