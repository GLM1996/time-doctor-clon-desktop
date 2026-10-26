import test from 'node:test';
import assert from 'node:assert/strict';
import { TrustedClock } from '../src/main/services/trustedClock.js';
import { calculateElapsedSeconds } from '../src/main/services/timerServiceUtils.js';
import { pruneOfflineQueue } from '../src/main/services/offlineQueuePolicy.js';
import { buildPendingExistingStop } from '../src/main/services/sessionPayloads.js';

test('tracking ignores an incorrect PC date and later forward/backward clock changes', () => {
  let tick = 100;
  const clock = new TrustedClock(() => tick);
  const serverStart = '2026-10-26T12:00:00.000Z';
  const originalNow = Date.now;
  try {
    Date.now = () => Date.parse('2036-01-01');
    clock.synchronize(serverStart);
    tick += 65000;
    assert.equal(calculateElapsedSeconds(serverStart, clock.now()), 65);
    Date.now = () => Date.parse('2000-01-01');
    tick += 35000;
    assert.equal(calculateElapsedSeconds(serverStart, clock.now()), 100);
    const pending = buildPendingExistingStop({
      sessionId: 'session', endTime: clock.date(),
      duration: calculateElapsedSeconds(serverStart, clock.now()),
    });
    assert.equal(pending.endTime, '2026-10-26T12:01:40.000Z');
    assert.equal(pending.duration, 100);
    Date.now = () => Date.parse('2036-01-01');
    assert.equal(pruneOfflineQueue([pending], { now: clock.now() }).length, 1);
  } finally {
    Date.now = originalNow;
  }
});

test('a trusted reference is required before tracking offline after launch', () => {
  const clock = new TrustedClock(() => 0);
  clock.synchronize(undefined);
  clock.synchronize('invalid');
  assert.equal(clock.isReady(), false);
  assert.throws(() => clock.now(), /Conecta con el servidor/);
});

test('later or delayed responses do not move an established clock backwards', () => {
  let tick = 0;
  const clock = new TrustedClock(() => tick);
  clock.synchronize('2026-10-26T12:00:00Z');
  tick = 10000;
  clock.synchronize('2026-10-26T11:59:00Z');
  assert.equal(clock.date().toISOString(), '2026-10-26T12:00:10.000Z');
});
