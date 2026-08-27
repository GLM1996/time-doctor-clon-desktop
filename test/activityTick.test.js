import test from 'node:test';
import assert from 'node:assert/strict';
import { accumulateActivityTime, advanceActivityWindow, calculateTickDelta } from '../src/main/services/activityTick.js';

test('calculateTickDelta ignora fracciones y limita suspensiones a un segundo', () => {
  assert.deepEqual(calculateTickDelta({ now: 1500, lastTickTime: 1000 }), { seconds: 0, suspendedSeconds: 0 });
  assert.deepEqual(calculateTickDelta({ now: 4000, lastTickTime: 1000 }), { seconds: 3, suspendedSeconds: 0 });
  assert.deepEqual(calculateTickDelta({ now: 21000, lastTickTime: 1000 }), { seconds: 1, suspendedSeconds: 20 });
});

test('advanceActivityWindow conserva tamaño y añade muestras recientes', () => {
  assert.deepEqual(advanceActivityWindow([false, false, true], true, 2), [true, true, true]);
  assert.deepEqual(advanceActivityWindow([true, true], false, 5), [false, false]);
});

test('accumulateActivityTime asigna el delta al contador correcto', () => {
  assert.deepEqual(accumulateActivityTime({ activeTime: 5, idleTime: 2, hasRecentInput: true, seconds: 3 }), { activeTime: 8, idleTime: 2 });
  assert.deepEqual(accumulateActivityTime({ activeTime: 5, idleTime: 2, hasRecentInput: false, seconds: 3 }), { activeTime: 5, idleTime: 5 });
});
