// Probe for tests/safety.test.js case 4: calls workdir() from the tests/lib.js named in argv[2] (default ../lib.js), then prints "workdir ran".
// Exit 0 when workdir() returned; the #13 guard makes it exit non-zero with a message when os.tmpdir() is misplaced.
"use strict";
const path = require("path");

const lib = require(process.argv[2] || path.join(__dirname, "..", "lib.js"));
lib.workdir("probe");
console.log(`workdir ran in ${lib.W}`);
