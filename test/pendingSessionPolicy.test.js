import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildOfflineSessionPayload,
  buildStopSessionPayload,
  classifyPendingSessionError,
  getRemoteSessionId,
  getPendingSessionKey,
  getSessionRetryAttempts,
  isPendingSessionReady,
  holdPendingSession,
  schedulePendingSessionRetry,
} from '../src/main/services/pendingSessionPolicy.js';

test('una operación pendiente respeta su fecha de próximo reintento', () => {
  const now = Date.parse('2026-08-13T12:00:00.000Z');
  assert.equal(isPendingSessionReady({}, now), true);
  assert.equal(isPendingSessionReady({ nextRetryAt: '2026-08-13T12:01:00.000Z' }, now), false);
  assert.equal(isPendingSessionReady({ nextRetryAt: 'invalid' }, now), true);
});

test('cada tipo de operación pendiente obtiene una clave estable', () => {
  assert.equal(
    getPendingSessionKey({ type: 'offline-session', localId: 'offline-one' }),
    'offline-session:offline-one',
  );
  assert.equal(
    getPendingSessionKey({ type: 'stop-existing', sessionId: 'remote-one' }),
    'stop-existing:remote-one',
  );
  assert.equal(getPendingSessionKey({ type: 'offline-session' }), null);
});

test('clasifica errores de sesión sin retener datos inválidos para siempre', () => {
  assert.equal(classifyPendingSessionError({ code: 'ERR_NETWORK' }, {}), 'retry');
  assert.equal(classifyPendingSessionError({ response: { status: 503 } }, {}), 'retry');
  assert.equal(classifyPendingSessionError({ response: { status: 429 } }, {}), 'retry');
  assert.equal(
    classifyPendingSessionError({ response: { status: 409 } }, { type: 'offline' }),
    'retry',
  );
  assert.equal(classifyPendingSessionError({ response: { status: 401 } }, {}), 'hold');
  assert.equal(classifyPendingSessionError({ response: { status: 400 } }, {}), 'discard');
  assert.equal(classifyPendingSessionError({ response: { status: 403 } }, {}), 'discard');
  assert.equal(classifyPendingSessionError({ response: { status: 422 } }, {}), 'discard');
});

test('una sesión retenida conserva sus datos y espera una nueva autenticación', () => {
  const held = holdPendingSession(
    { localId: 'offline-1', retryCount: 2, nextRetryAt: '2026-08-13T12:00:00.000Z' },
    { response: { data: { message: 'Token expirado' } } },
  );
  assert.equal(held.localId, 'offline-1');
  assert.equal(held.retryCount, 2);
  assert.equal(held.nextRetryAt, null);
  assert.equal(held.lastError, 'Token expirado');
});

test('los payloads incluyen únicamente campos admitidos y definidos', () => {
  const pending = { sessionId: 'one', reason: 'manual', notes: undefined, duration: 20, projectId: 'project', taskId: 'task', extra: true };
  assert.deepEqual(buildStopSessionPayload(pending), { reason: 'manual', duration: 20 });
  assert.deepEqual(buildOfflineSessionPayload(pending), { duration: 20, reason: 'manual', projectId: 'project', taskId: 'task' });
});

test('la política normaliza reintentos e identifica la sesión remota', () => {
  assert.equal(getSessionRetryAttempts({ sync: { retryAttempts: '4.9' } }), 4);
  assert.equal(getSessionRetryAttempts({ sync: { retryAttempts: 0 } }), 3);
  assert.equal(getSessionRetryAttempts({ sync: { retryAttempts: 999 } }), 10);
  assert.equal(getRemoteSessionId({ data: { data: { _id: 'remote' } } }), 'remote');
  const retry = schedulePendingSessionRetry({ retryCount: 0 }, new Error('fallo'), 0);
  assert.equal(retry.retryCount, 1);
  assert.equal(retry.nextRetryAt, '1970-01-01T00:00:30.000Z');
  assert.equal(retry.lastError, 'fallo');
});
