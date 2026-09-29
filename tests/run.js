// Runs every tests/*.test.js in turn and totals their "N passed, M failed" lines.
// Exits 1 if any file exits non-zero, prints no summary line, or none are found; else 0.
"use strict";
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const files = fs.readdirSync(__dirname).filter((f) => f.endsWith(".test.js")).sort();
console.log(`${__dirname}: ${files.length} test files`);
let pass = 0, fail = 0, bad = 0;
for (const f of files) {
  const r = spawnSync(process.execPath, [path.join(__dirname, f)], { encoding: "utf8" });
  process.stdout.write(r.stdout || "");
  process.stderr.write(r.stderr || "");
  const m = /^(\d+) passed, (\d+) failed$/m.exec(r.stdout || "");
  if (m) { pass += +m[1]; fail += +m[2]; }
  if (r.status !== 0 || !m) { bad++; if (!m) console.log(`FAIL ${f}: no summary line`); }
}
console.log(`\n${pass} passed, ${fail} failed across ${files.length} files`);
process.exitCode = bad || !files.length ? 1 : 0;
