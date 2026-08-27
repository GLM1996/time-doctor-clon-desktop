import test from 'node:test';
import assert from 'node:assert/strict';
import { persistAuthSession } from '../src/main/services/authPersistencePolicy.js';

function createStorage(results = {}) {
  const calls = [];
  return {
    calls,
    setToken: () => results.token !== false,
    setRefreshToken: () => results.refreshToken !== false,
    setSessionId: () => results.sessionId !== false,
    clearRefreshToken: () => calls.push('clearRefreshToken'),
    clearSessionId: () => calls.push('clearSessionId'),
    clearAll: () => calls.push('clearAll'),
  };
}

test('persiste una sesion completa como una sola operacion logica', () => {
  const storage = createStorage();
  assert.equal(persistAuthSession(storage, {
    accessToken: 'access', refreshToken: 'refresh', sessionId: 'session',
  }), true);
  assert.deepEqual(storage.calls, []);
});

test('limpia escrituras parciales cuando falla cualquier secreto', () => {
  const storage = createStorage({ refreshToken: false });
  assert.equal(persistAuthSession(storage, {
    accessToken: 'access', refreshToken: 'refresh', sessionId: 'session',
  }), false);
  assert.deepEqual(storage.calls, ['clearAll']);
});

test('rechaza pares de refresh incompletos y admite access token independiente', () => {
  const incomplete = createStorage();
  assert.equal(persistAuthSession(incomplete, {
    accessToken: 'access', refreshToken: 'refresh',
  }), false);
  assert.deepEqual(incomplete.calls, ['clearRefreshToken', 'clearSessionId', 'clearAll']);

  const accessOnly = createStorage();
  assert.equal(persistAuthSession(accessOnly, { accessToken: 'access' }), true);
  assert.deepEqual(accessOnly.calls, ['clearRefreshToken', 'clearSessionId']);
});
