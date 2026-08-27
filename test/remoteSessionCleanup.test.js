import test from 'node:test';
import assert from 'node:assert/strict';
import { revokeRemoteSession } from '../src/main/services/remoteSessionCleanup.js';

test('revoca la sesion remota sin habilitar otro refresh', async () => {
  let request;
  const result = await revokeRemoteSession({
    post: async (...args) => { request = args; },
    accessToken: 'access', refreshToken: 'refresh', sessionId: 'session',
  });
  assert.equal(result, true);
  assert.deepEqual(request, [
    '/auth/logout',
    { refreshToken: 'refresh', sessionId: 'session' },
    { _skipAuthRefresh: true, headers: { Authorization: 'Bearer access' } },
  ]);
});

test('omite datos incompletos y contiene errores de limpieza', async () => {
  assert.equal(await revokeRemoteSession({ post: async () => {}, accessToken: 'access' }), false);
  let captured;
  const result = await revokeRemoteSession({
    post: async () => { throw new Error('offline'); },
    accessToken: 'access', refreshToken: 'refresh', sessionId: 'session',
    onError: error => { captured = error.message; },
  });
  assert.equal(result, false);
  assert.equal(captured, 'offline');
});
