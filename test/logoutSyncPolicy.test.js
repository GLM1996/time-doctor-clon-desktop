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

test('logout is blocked while offline data remains', () => {
  const result = evaluateLogoutSyncState({ pendingTotal: 3 });
  assert.equal(result.canLogout, false);
  assert.equal(result.pendingTotal, 3);
  assert.match(result.message, /3 operaciones/);
});
