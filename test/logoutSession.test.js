import test from 'node:test';
import assert from 'node:assert/strict';
import { logoutSession } from '../src/main/services/logoutSession.js';

test('pending data and an unreachable server never delay logout', async () => {
  const calls = [];
  const user = { _id: 'owner' };
  const result = logoutSession({
    timer: { prepareForShutdown: () => calls.push('save'), getSyncStatus: () => ({ pendingTotal: 1 }) },
    store: { getUser: () => user, getRefreshToken: () => 'refresh', getSessionId: () => 'id', getToken: () => 'token', clearAll: () => calls.push('clear'), setUser: value => { assert.equal(value,user); calls.push('owner'); } },
    api: { post: () => new Promise(() => {}), clearToken: () => calls.push('clearClient') },
    tray: { refreshIdentity: () => calls.push('tray') },
  });
  assert.equal(result.success, true);
  assert.deepEqual(calls, ['save','clear','owner','clearClient','tray']);
});

test('disk, monitoring and UI cleanup failures cannot veto logout', () => {
  const fail = () => { throw new Error('unavailable'); };
  let clearedClient = false;
  const result = logoutSession({
    timer: { prepareForShutdown: fail, getSyncStatus: fail },
    store: { getUser: fail, getRefreshToken: fail, getSessionId: fail, getToken: fail, clearAll: fail },
    api: { clearToken: () => { clearedClient = true; } }, tray: { refreshIdentity: fail },
  });
  assert.equal(result.success, true);
  assert.equal(clearedClient, true);
});
