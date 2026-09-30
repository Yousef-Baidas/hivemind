#!/usr/bin/env node
// fake claude for the tests: prints fixed plugin state and never touches the network (#35).
// Stub until #35 lands: always exits 1 with "not implemented: #35" on stderr.
"use strict";
process.stderr.write("not implemented: #35\n");
process.exit(1);
