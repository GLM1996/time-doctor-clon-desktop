import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateIdleState } from '../src/main/services/idleStatePolicy.js';

const base = {
  idleThresholdSeconds: 300,
  idleWarningSeconds: 480,
  autoCloseInactiveSeconds: 600,
  idleStartTime: null,
  warningSent: false,
  now: 1_000_000,
};

test('la actividad por debajo del umbral reinicia el estado idle', () => {
  const result = evaluateIdleState({ ...base, systemIdleTime: 20, idleStartTime: 100 });
  assert.equal(result.phase, 'active');
  assert.equal(result.shouldResetWarning, true);
  assert.equal(result.idleStartTime, null);
});

test('la política conserva countdown antes de la advertencia', () => {
  const result = evaluateIdleState({ ...base, systemIdleTime: 400 });
  assert.equal(result.phase, 'idle');
  assert.equal(result.idleDuration, 400);
  assert.equal(result.secondsUntilClose, 200);
});

test('la advertencia se emite una sola vez y el cierre ocurre en el límite', () => {
  assert.equal(evaluateIdleState({ ...base, systemIdleTime: 480 }).shouldWarn, true);
  assert.equal(evaluateIdleState({ ...base, systemIdleTime: 480, warningSent: true }).shouldWarn, false);
  const closed = evaluateIdleState({ ...base, systemIdleTime: 600 });
  assert.equal(closed.phase, 'close');
  assert.equal(closed.shouldClose, true);
  assert.equal(closed.secondsUntilClose, 0);
});
