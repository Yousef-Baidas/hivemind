"use strict";
// ruleset probe for #70: fails on purpose so gates goes red
process.exitCode = 1;
console.log("0 passed, 1 failed");
