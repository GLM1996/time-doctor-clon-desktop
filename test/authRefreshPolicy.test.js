import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getRefreshFailureMessage,
  isAuthenticationRequiredError,
  shouldRevokeSessionAfterRefreshError,
} from '../src/main/services/authRefreshPolicy.js';

test('only terminal refresh responses revoke the local session', () => {
  assert.equal(shouldRevokeSessionAfterRefreshError({ response: { status: 401 } }), true);
  assert.equal(shouldRevokeSessionAfterRefreshError({ response: { status: 403 } }), true);
  assert.equal(shouldRevokeSessionAfterRefreshError({ response: { status: 500 } }), false);
  assert.equal(shouldRevokeSessionAfterRefreshError({ code: 'ERR_NETWORK' }), false);
});

test('only an unauthorized API response pauses queues for authentication', () => {
  assert.equal(isAuthenticationRequiredError({ response: { status: 401 } }), true);
  assert.equal(isAuthenticationRequiredError({ response: { status: 403 } }), false);
  assert.equal(isAuthenticationRequiredError({ code: 'ERR_NETWORK' }), false);
});

test('refresh failures distinguish connectivity from revocation', () => {
  assert.match(getRefreshFailureMessage({ code: 'ERR_NETWORK' }), /conexión/);
  assert.match(getRefreshFailureMessage({ response: { status: 401 } }), /revocada/);
});
