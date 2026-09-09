import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateElapsedSeconds,
  formatDuration,
  isAlreadyClosedSessionError,
  isNetworkError,
} from '../src/main/services/timerServiceUtils.js';

test('calculateElapsedSeconds usa tiempo real y no acumula retrasos del intervalo', () => {
  const start = new Date('2026-09-05T09:00:00.000Z');
  assert.equal(calculateElapsedSeconds(start, new Date('2026-09-05T09:01:01.900Z')), 61);
  assert.equal(calculateElapsedSeconds(start, new Date('2026-09-05T17:00:00.000Z')), 28800);
  assert.equal(calculateElapsedSeconds(start, new Date('2026-09-05T08:59:59.000Z')), 0);
  assert.equal(calculateElapsedSeconds('invalid', Date.now()), 0);
});

test('formatDuration normaliza valores inválidos y produce HH:MM:SS', () => {
  assert.equal(formatDuration(0), '00:00:00');
  assert.equal(formatDuration(3661), '01:01:01');
  assert.equal(formatDuration(-20), '00:00:00');
  assert.equal(formatDuration('invalid'), '00:00:00');
});

test('isNetworkError distingue fallos de red de respuestas HTTP', () => {
  assert.equal(isNetworkError({ code: 'ECONNREFUSED' }), true);
  assert.equal(isNetworkError({ code: 'ETIMEDOUT' }), true);
  assert.equal(isNetworkError({ response: { status: 522 } }), true);
  assert.equal(isNetworkError({ response: { status: 503 } }), true);
  assert.equal(isNetworkError({ response: { status: 400 } }), false);
});

test('isAlreadyClosedSessionError reconoce estado y mensajes equivalentes', () => {
  assert.equal(isAlreadyClosedSessionError({ response: { status: 409 } }), true);
  assert.equal(isAlreadyClosedSessionError({ message: 'La sesión ya está finalizada' }), true);
  assert.equal(isAlreadyClosedSessionError({ message: 'Session has ended' }), true);
  assert.equal(isAlreadyClosedSessionError({ response: { status: 500 } }), false);
});
