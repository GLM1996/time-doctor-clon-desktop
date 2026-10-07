import test from "node:test";
import assert from "node:assert/strict";
import { reconcileObservedElapsed } from "../src/renderer/hooks/useTimerSession.js";

test("a delayed start acknowledgement cannot move the running counter backwards", () => {
  assert.equal(reconcileObservedElapsed(4, undefined, false), 4);
  assert.equal(reconcileObservedElapsed(4, 0, false), 4);
  assert.equal(reconcileObservedElapsed(4, 6, false), 6);
});

test("an explicit reset can still clear the counter after closing the session", () => {
  assert.equal(reconcileObservedElapsed(4, 0, true), 0);
});
