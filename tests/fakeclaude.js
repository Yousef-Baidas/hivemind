#!/usr/bin/env node
// fake claude for the tests: records the context-mode plugin in the fake HOME the way the real CLI does, and prints fixed plugin state; never touches the network (#35).
// Exit 0 for --version and the plugin commands the installer runs; 1 for anything else, when FAKE_CLAUDE=fail, or when HOME is the real user home.
// CLAUDE_LOG, when set, gets one line per call with the arguments.
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");

const CTX = "context-mode@context-mode";
const a = process.argv.slice(2).join(" ");
if (process.env.CLAUDE_LOG) fs.appendFileSync(process.env.CLAUDE_LOG, a + "\n");
if (process.env.FAKE_CLAUDE === "fail") { process.stderr.write("fake claude: FAKE_CLAUDE=fail\n"); process.exit(1); }
if (a === "--version") { process.stdout.write("2.0.0 (Claude Code)\n"); process.exit(0); }

// the fake only ever writes a temp HOME
let real = "";
try { real = os.userInfo().homedir; } catch {}
if (real && path.resolve(os.homedir()) === path.resolve(real)) { process.stderr.write(`fake claude: refusing to write the real home ${real}\n`); process.exit(1); }

const d = path.join(os.homedir(), ".claude"), plugins = path.join(d, "plugins"), settings = path.join(d, "settings.json");
const rd = (f) => { try { return JSON.parse(fs.readFileSync(f, "utf8")) || {}; } catch { return {}; } };
const enable = () => { const s = rd(settings); s.enabledPlugins = { ...s.enabledPlugins, [CTX]: true }; fs.writeFileSync(settings, JSON.stringify(s)); };

if (a === "plugin marketplace add mksglu/context-mode") {
  fs.mkdirSync(plugins, { recursive: true });
  fs.writeFileSync(path.join(plugins, "known_marketplaces.json"), JSON.stringify({ "context-mode": {} }));
  process.exit(0);
}
if (a === `plugin install ${CTX} --scope user`) {
  fs.mkdirSync(plugins, { recursive: true });
  fs.writeFileSync(path.join(plugins, "installed_plugins.json"), JSON.stringify({ version: 2, plugins: { [CTX]: [{ scope: "user" }] } }));
  enable();
  process.exit(0);
}
if (a === `plugin enable ${CTX} --scope user`) { fs.mkdirSync(d, { recursive: true }); enable(); process.exit(0); }
if (a === "plugin list") {
  const installed = Object.keys(rd(path.join(plugins, "installed_plugins.json")).plugins || {});
  const on = rd(settings).enabledPlugins || {};
  process.stdout.write(installed.length ? installed.map((p) => `${p} (${on[p] ? "enabled" : "disabled"})\n`).join("") : "No plugins installed\n");
  process.exit(0);
}
process.stderr.write("fake claude: unhandled " + a + "\n");
process.exit(1);
