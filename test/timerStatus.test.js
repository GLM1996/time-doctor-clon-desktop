import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTimerStatus, buildTimerUpdate } from '../src/main/services/timerStatus.js';

test('buildTimerStatus normaliza el contrato completo del temporizador', () => {
  const result = buildTimerStatus({
    isRunning: 1,
    currentBreakId: '',
    isOffline: 0,
    elapsedSeconds: 61.9,
    pendingOperations: -5,
  });
  assert.equal(result.isRunning, true);
  assert.equal(result.isPaused, false);
  assert.equal(result.elapsedSeconds, 61);
  assert.equal(result.elapsedFormatted, '00:01:01');
  assert.equal(result.pendingOperations, 0);
  assert.equal(result.sessionId, null);
});

test('buildTimerUpdate utiliza el mismo estado de pausa, tiempo y sesión', () => {
  assert.deepEqual(buildTimerUpdate({
    isRunning: true,
    currentBreakId: 'break',
    isOffline: true,
    elapsedSeconds: '3600',
    sessionId: 'session',
  }), {
    isRunning: true,
    isPaused: true,
    isOffline: true,
    elapsedSeconds: 3600,
    elapsedFormatted: '01:00:00',
    sessionId: 'session',
  });
});
