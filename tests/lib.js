"use strict";
function notImplemented() {
  throw new Error("not implemented: #3");
}
module.exports = {
  ok: notImplemented,
  run: notImplemented,
  g: notImplemented,
  workdir: notImplemented,
  summary: notImplemented,
  get ENV() { return notImplemented(); },
  get BIN() { return notImplemented(); },
  get HOME() { return notImplemented(); },
  get W() { return notImplemented(); },
};
