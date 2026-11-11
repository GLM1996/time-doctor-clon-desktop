import test from 'node:test';
import assert from 'node:assert/strict';
import { TrustedClock } from '../src/main/services/trustedClock.js';

test('server time ignores local wall-clock changes and measures elapsed time', () => {
  let tick = 0;
  const clock = new TrustedClock(() => tick);
  const originalNow = Date.now;
  try {
    Date.now = () => Date.parse('2040-01-01');
    clock.synchronize('2026-11-11T12:00:00Z');
    tick = 65000;
    assert.equal(clock.date().toISOString(), '2026-11-11T12:01:05.000Z');
    Date.now = () => Date.parse('2000-01-01');
    tick += 35000;
    assert.equal(clock.date().toISOString(), '2026-11-11T12:01:40.000Z');
  } finally { Date.now = originalNow; }
});

test('requires a valid server sample and rejects slow or out-of-order responses', () => {
  let tick = 0;
  const clock = new TrustedClock(() => tick);
  assert.throws(() => clock.now(), /servidor/);
  assert.equal(clock.synchronize('invalid'), false);
  tick = 11000;
  assert.equal(clock.synchronize('2026-11-11T12:00:00Z', 0), false);
  assert.equal(clock.isReady(), false);
  assert.equal(clock.synchronize('2026-11-11T12:00:00Z', tick), true);
  tick += 100;
  assert.equal(clock.synchronize('2026-11-11T11:00:00Z', 10000), false);
  assert.equal(clock.date().toISOString(), '2026-11-11T12:00:00.100Z');
});

test('resynchronizes after suspension, compensates latency and never goes backwards', () => {
  let tick = 0;
  const clock = new TrustedClock(() => tick);
  clock.synchronize('2026-11-11T12:00:00Z');
  tick = 1000;
  const before = clock.now();
  clock.synchronize('2026-11-11T11:59:59Z', 1000);
  assert.equal(clock.now(), before);
  tick = 1200;
  clock.synchronize('2026-11-11T14:00:00Z', 1000);
  assert.equal(clock.date().toISOString(), '2026-11-11T14:00:00.100Z');
});
