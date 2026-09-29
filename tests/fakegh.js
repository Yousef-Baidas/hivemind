#!/usr/bin/env node
// fake gh for the hook tests: canned JSON by argument pattern; FAKE_GH=fail → exit 1
const a = process.argv.slice(2).join(" ");
if (process.env.FAKE_GH === "fail") { process.stderr.write("gh: no remote\n"); process.exit(1); }
const out = (o) => { process.stdout.write(JSON.stringify(o)); process.exit(0); };
const iso = (h) => new Date(Date.UTC(2026, 8, 1) + h * 3600e3).toISOString();
if (/issue list --label hive-log/.test(a)) out([{ number: 7, title: "Run: bl1077" }]);
if (/issue view 7 --json comments/.test(a)) out({ comments: Array.from({ length: 15 }, (_, i) => ({ body: `decision ${i + 1}: ` + "x".repeat(i === 14 ? 50 : 300) })) });
if (/issue list --label needs-human/.test(a)) out([
  { number: 21, title: "Q: bl1077: which db", labels: [{ name: "hive-question" }, { name: "needs-human" }] },
  { number: 23, title: "Q: bl1077: colour", labels: [{ name: "hive-question" }, { name: "needs-human" }] },
  { number: 22, title: "Review: bl1077/lighting", labels: [{ name: "hive-review" }, { name: "needs-human" }] },
]);
if (/issue list --label hive --state all/.test(a)) {
  const ms = { number: 3, title: "bl1077/lighting" };
  out([
    { number: 1, state: "CLOSED", createdAt: iso(0), closedAt: iso(0.5), milestone: ms, labels: [{ name: "hive" }] },
    { number: 2, state: "CLOSED", createdAt: iso(0), closedAt: iso(0.75), milestone: ms, labels: [{ name: "hive" }] },
    { number: 3, state: "CLOSED", createdAt: iso(1), closedAt: iso(1.5), milestone: ms, labels: [{ name: "hive" }] },
    { number: 4, state: "OPEN", createdAt: iso(2), closedAt: null, milestone: ms, labels: [{ name: "hive" }] },
    { number: 5, state: "OPEN", createdAt: iso(2), closedAt: null, milestone: ms, labels: [{ name: "hive" }] },
    { number: 6, state: "OPEN", createdAt: iso(2), closedAt: null, milestone: ms, labels: [{ name: "hive" }] },
    { number: 9, state: "OPEN", createdAt: iso(2), closedAt: null, milestone: ms, labels: [{ name: "hive-review" }] },
    { number: 7, state: "OPEN", createdAt: iso(0), closedAt: null, milestone: null, labels: [{ name: "hive-log" }] },
  ]);
}
if (/pr list --base hive\/bl1077/.test(a)) out([
  { number: 40, headRefName: "hive/bl1077-4", reviews: [{ body: "MERGE" }], comments: [] },
  { number: 41, headRefName: "hive/bl1077-5", reviews: [], comments: [{ body: "working" }] },
]);
process.stderr.write("fake gh: unhandled " + a + "\n");
process.exit(1);
