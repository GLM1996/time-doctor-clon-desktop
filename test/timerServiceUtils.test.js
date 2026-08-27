import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatDuration,
  isAlreadyClosedSessionError,
  isNetworkError,
} from '../src/main/services/timerServiceUtils.js';

test('formatDuration normaliza valores inválidos y produce HH:MM:SS', () => {
  assert.equal(formatDuration(0), '00:00:00');
  assert.equal(formatDuration(3661), '01:01:01');
  assert.equal(formatDuration(-20), '00:00:00');
  assert.equal(formatDuration('invalid'), '00:00:00');
});

test('isNetworkError distingue fallos de red de respuestas HTTP', () => {
  assert.equal(isNetworkError({ code: 'ECONNREFUSED' }), true);
  assert.equal(isNetworkError({ code: 'ETIMEDOUT' }), true);
  assert.equal(isNetworkError({ response: { status: 400 } }), false);
});

test('isAlreadyClosedSessionError reconoce estado y mensajes equivalentes', () => {
  assert.equal(isAlreadyClosedSessionError({ response: { status: 409 } }), true);
  assert.equal(isAlreadyClosedSessionError({ message: 'La sesión ya está finalizada' }), true);
  assert.equal(isAlreadyClosedSessionError({ message: 'Session has ended' }), true);
  assert.equal(isAlreadyClosedSessionError({ response: { status: 500 } }), false);
});
