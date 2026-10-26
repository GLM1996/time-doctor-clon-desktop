import test from "node:test";
import assert from "node:assert/strict";
import { reconcileObservedElapsed, reconcileElapsedObservation } from "../src/renderer/hooks/useTimerSession.js";

test("a delayed start acknowledgement cannot move the running counter backwards", () => {
  assert.equal(reconcileObservedElapsed(4, undefined, false), 4);
  assert.equal(reconcileObservedElapsed(4, 0, false), 4);
  assert.equal(reconcileObservedElapsed(4, 6, false), 6);
});

test("an explicit reset can still clear the counter after closing the session", () => {
  assert.equal(reconcileObservedElapsed(4, 0, true), 0);
});

test("frequent stale updates cannot freeze the local clock during a connection failure", () => {
  let observation = { seconds: 10, at: 0 };
  for (let now = 250; now <= 10000; now += 250) {
    observation = reconcileElapsedObservation(observation, 10, now, false);
  }
  assert.deepEqual(observation, { seconds: 20, at: 10000 });
});

test("delayed updates account for time since the last local tick", () => {
  assert.deepEqual(
    reconcileElapsedObservation({ seconds: 10, at: 0 }, 11, 3500, false),
    { seconds: 13, at: 3000 },
  );
});

test("fresh observations advance the clock and explicit stops reset it", () => {
  assert.deepEqual(
    reconcileElapsedObservation({ seconds: 10, at: 0 }, 20, 1500, false),
    { seconds: 20, at: 1500 },
  );
  assert.deepEqual(
    reconcileElapsedObservation({ seconds: 10, at: 0 }, 0, 1500, true),
    { seconds: 0, at: 1500 },
  );
});
