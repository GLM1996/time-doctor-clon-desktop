import assert from 'node:assert/strict';
import test from 'node:test';
import { canUsePendingData, getUserIdentity } from '../src/main/services/pendingDataOwnerPolicy.js';

test('user identity prefers stable ids and normalizes email fallback', () => {
  assert.equal(getUserIdentity({ _id: '123', email: 'a@example.com' }), 'id:123');
  assert.equal(getUserIdentity({ email: ' User@Example.com ' }), 'email:user@example.com');
});

test('pending data only permits its original owner', () => {
  assert.equal(canUsePendingData({ previousUser: { _id: 'a' }, nextUser: { _id: 'a' }, pendingTotal: 2 }), true);
  assert.equal(canUsePendingData({ previousUser: { _id: 'a' }, nextUser: { _id: 'b' }, pendingTotal: 2 }), false);
  assert.equal(canUsePendingData({ previousUser: { _id: 'a' }, nextUser: { _id: 'b' }, pendingTotal: 0 }), true);
});
