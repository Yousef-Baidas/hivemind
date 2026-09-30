// Check lib-sandbox (#35): tests/lib.js sandbox(tag) gives each run its own temp dir, fakes and env; workdir(name) validates its name.
// child_process.execFileSync and spawnSync are wrapped before lib.js loads, so the spawn options git() builds can be read back.
// Exit 0 if every assertion passed, 1 otherwise; sandboxes are cleaned up only when every assertion here passed.
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const cp = require("child_process");

// record every spawn's options; lib.js destructures child_process at load, so this must run first
const calls = [];
const realExecFileSync = cp.execFileSync, realSpawnSync = cp.spawnSync;
const record = (a) => { const hasArgs = Array.isArray(a[1]); calls.push({ file: String(a[0]), args: hasArgs ? a[1] : [], opts: (hasArgs ? a[2] : a[1]) || {} }); };
cp.execFileSync = (...a) => { record(a); return realExecFileSync(...a); };
cp.spawnSync = (...a) => { record(a); return realSpawnSync(...a); };

const LIB = path.join(__dirname, "lib.js");
console.log(`${LIB}: ${fs.statSync(LIB).size} bytes, 1 file`);
const { ok, summary, sandbox, workdir } = require(LIB);

let bad = 0;
const check = (name, cond, extra) => { if (!cond) bad++; ok(name, cond, extra); };
const under = (child, parent) => { const r = path.relative(parent, path.resolve(child)); return r !== "" && !r.startsWith("..") && !path.isAbsolute(r); };
const attempt = (fn) => { try { return { value: fn() }; } catch (e) { return { error: e }; } };
const made = [];
const open = (tag) => { const r = attempt(() => sandbox(tag)); if (r.value) made.push(r.value); return r; };
const item = (name, fn) => {
  const r = open("lib");
  if (r.error) return check(name, false, r.error.message);
  try { fn(r.value); } catch (e) { check(name, false, e.stack || e.message); }
};

// 1. two calls, two dirs, no crosstalk
const a = open("x"), b = open("x");
if (a.error || b.error) check('two sandbox("x") calls return unique dirs', false, (a.error || b.error).message);
else {
  check('two sandbox("x") calls return unique dirs', a.value.dir !== b.value.dir && fs.existsSync(a.value.dir) && fs.existsSync(b.value.dir), `${a.value.dir} ${b.value.dir}`);
  check("neither sandbox dir is inside the other", !under(a.value.dir, b.value.dir) && !under(b.value.dir, a.value.dir), `${a.value.dir} ${b.value.dir}`);
  fs.writeFileSync(path.join(a.value.dir, "marker"), "a");
  check("a write in one sandbox does not appear in the other", !fs.existsSync(path.join(b.value.dir, "marker")));
  a.value.cleanup();
  check("cleaning up one sandbox leaves the other in place", fs.existsSync(b.value.dir) && fs.existsSync(b.value.bin), b.value.dir);
}

// 2. bad tag or name throws before any write; os.tmpdir() points at an empty dir so a stray write shows
const base = fs.mkdtempSync(path.join(os.tmpdir(), "proteus-libtest-"));
const realTmpdir = os.tmpdir;
// tmpdir sits two levels below base, so an escaping tag's mkdtemp still lands inside base
const nested = path.join(base, "n1", "n2");
fs.mkdirSync(nested, { recursive: true });
let badTag, escTag, badName;
os.tmpdir = () => nested;
try {
  badTag = attempt(() => sandbox("../x"));
  escTag = attempt(() => sandbox("a/../../x"));
  badName = attempt(() => workdir("a/.."));
} finally {
  os.tmpdir = realTmpdir;
}
check('sandbox("../x") throws a validation error', !!badTag.error && !/not implemented/.test(badTag.error.message), badTag.error ? badTag.error.message : "returned");
check('sandbox("a/../../x") throws', !!escTag.error, escTag.error ? escTag.error.message : `returned ${escTag.value.dir}`);
check('workdir("a/..") throws', !!badName.error, badName.error ? badName.error.message : "returned");
const left = fs.readdirSync(base, { recursive: true }).map((p) => p.split(path.sep).join("/")).sort();
check("an invalid tag or name creates nothing, inside os.tmpdir() or above it", left.join(" ") === "n1 n1/n2", left.join(" "));
fs.rmSync(base, { recursive: true, force: true });

// 3. the sandbox env keeps every home under dir
item("env.HOME, env.USERPROFILE and env.CODEX_HOME resolve under dir", (s) => {
  for (const k of ["HOME", "USERPROFILE", "CODEX_HOME"]) check(`env.${k} resolves under dir`, typeof s.env[k] === "string" && under(s.env[k], s.dir), `${k}=${s.env[k]} dir=${s.dir}`);
});

// 4. the installer runs inside the sandbox
item('installer(["--help"]) exits 0', (s) => {
  const r = s.installer(["--help"]);
  check('installer(["--help"]) exits 0', r.code === 0, `${r.code} ${r.err}`);
});

// 5. git() works and its spawn options carry windowsHide and a timeout
item('git(dir, "init") creates a repo', (s) => {
  const from = calls.length;
  const out = s.git(s.dir, "init");
  check('git(dir, "init") returns a string and creates .git', typeof out === "string" && fs.existsSync(path.join(s.dir, ".git")), out);
  const call = calls.slice(from).find((c) => /(^|[\\/])git(\.exe)?$/i.test(c.file) && c.args.includes("init"));
  check("git() spawns git through child_process", !!call, calls.slice(from).map((c) => c.file).join(" "));
  const o = call ? call.opts : {};
  check("git() spawns with windowsHide: true", o.windowsHide === true, JSON.stringify(o.windowsHide));
  check("git() spawns with a timeout", typeof o.timeout === "number" && o.timeout > 0, JSON.stringify(o.timeout));
});

// 6. snapshot and drift see a written, an added and a deleted file, and a symlink
item("snapshot and drift report file and symlink changes", (s) => {
  const root = path.join(s.dir, "snap");
  fs.mkdirSync(path.join(root, "sub"), { recursive: true });
  fs.writeFileSync(path.join(root, "changed.txt"), "one");
  fs.writeFileSync(path.join(root, "gone.txt"), "x");
  const before = s.snapshot(root);
  fs.writeFileSync(path.join(root, "changed.txt"), "two");
  fs.writeFileSync(path.join(root, "added.txt"), "new");
  fs.rmSync(path.join(root, "gone.txt"));
  // a junction needs no privilege on windows; the type is ignored elsewhere
  fs.symlinkSync(path.join(root, "sub"), path.join(root, "link"), "junction");
  const after = s.snapshot(root);
  check("snapshot returns a Map", before instanceof Map && after instanceof Map);
  check("snapshot marks the symlink as a link", String(after.get("link")).startsWith("->"), String(after.get("link")));
  const d = s.drift(before, after);
  check("drift reports a written file", d.includes("changed.txt"), d.join(" "));
  check("drift reports an added file", d.includes("added.txt"), d.join(" "));
  check("drift reports a deleted file", d.includes("gone.txt"), d.join(" "));
  check("drift reports a new symlink", d.includes("link"), d.join(" "));
});

// 7. cleanup removes the dir
item("cleanup() removes dir", (s) => {
  s.cleanup();
  check("cleanup() removes dir", !fs.existsSync(s.dir), s.dir);
});

// 8. on win32 each fake gets a .cmd shim
const platform = Object.getOwnPropertyDescriptor(process, "platform");
let win;
Object.defineProperty(process, "platform", { ...platform, value: "win32" });
try { win = open("win"); } finally { Object.defineProperty(process, "platform", platform); }
if (win.error) check("on win32 bin contains gh.cmd and claude.cmd", false, win.error.message);
else {
  const ls = fs.readdirSync(win.value.bin);
  check("on win32 bin contains gh.cmd", ls.includes("gh.cmd"), ls.join(" "));
  check("on win32 bin contains claude.cmd", ls.includes("claude.cmd"), ls.join(" "));
}

if (!bad) for (const s of made) if (fs.existsSync(s.dir)) s.cleanup();
summary();
