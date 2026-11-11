import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateLogoutSyncState } from '../src/main/services/logoutSyncPolicy.js';

test('logout is allowed when all local data is synchronized', () => {
  assert.deepEqual(evaluateLogoutSyncState({ pendingTotal: 0 }), {
    canLogout: true,
    pendingTotal: 0,
    message: null,
  });
});

test('logout remains available while offline data is safely pending', () => {
  const result = evaluateLogoutSyncState({ pendingTotal: 3 });
  assert.equal(result.canLogout, true);
  assert.equal(result.pendingTotal, 3);
  assert.match(result.message, /guardados en este equipo/);
});
