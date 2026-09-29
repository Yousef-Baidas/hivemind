// Fixture for tests/lint.test.js: one known anti-slop violation (anti-slop/no-array-filter-map). Never run; lint ignores this dir.
"use strict";
const evens = [1, 2, 3, 4].filter((n) => n % 2 === 0).map((n) => n * 2);
module.exports = { evens };
