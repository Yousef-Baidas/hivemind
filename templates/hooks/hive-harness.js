// The harness adapter for this process: everything that differs between coding-agent CLIs.
// HIVE_HARNESS names it (default claude); an adapter is hive-harness-<name>.js beside this file.
// The hooks never read a CLI's hook JSON themselves: they get one hive event and answer through
// the adapter, so a new CLI is one new adapter file, not a change to every hook.
//
// Hive event (adapter.event(raw)); a field the CLI does not report is "" or false:
//   kind         session-start | prompt | pre-tool | post-tool | tool-failed | stop | subagent-stop | idle
//   session, cwd, root (the project dir), source (session-start: startup|resume|clear|compact|fork)
//   agent, agentType, teammate   set inside a subagent or teammate; "" on the main thread
//   model        the session's model when the event carries it
//   tool         edit | read | shell | monitor | spawn | "" (anything else); toolName is the CLI's own
//   path, command, background, spawnModel, toolUseId   from the tool call
//   prompt, fromHuman   a submitted prompt, and whether the human typed it
//   output, error       a finished tool call's stdout+stderr and error text
//   stopActive, busy    the stop was already blocked once; background work is still running
//   raw          the CLI's own JSON, for the adapter's transcript readers only
//
// Adapter contract (see hive-harness-claude.js for the reference):
//   answers      deny(why, {json}) · context(ev, text, kind) · keepGoing(ev, reason)
//   transcript   contextTokens(ev) · lastAssistantText(ev) · lastHumanPrompt(ev) · sessionModel(ev)
//   install      name · bypass · projectRoot(raw) · home · skillDirs(root) · agentsDir · hooksDir(root)
//                contextModeOn() · registerLead(root) · prepareWorker(wt, src) · ownedFile(wt)
"use strict";
const path = require("path");

const want = String(process.env.HIVE_HARNESS || "claude").toLowerCase().replace(/[^a-z0-9-]/g, "");
let adapter;
try { adapter = require(path.join(__dirname, `hive-harness-${want}.js`)); } catch { adapter = require(path.join(__dirname, "hive-harness-claude.js")); }

module.exports = adapter;
