import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStoredUser, serializeStoredUser } from '../src/main/services/storedUserPolicy.js';

test('serializa y recupera un perfil valido', () => {
  const user = { id: 'one', email: 'user@example.com', organization: { name: 'Acme' } };
  assert.deepEqual(parseStoredUser(serializeStoredUser(user)), user);
});

test('rechaza perfiles no validos, corruptos o excesivos', () => {
  assert.equal(serializeStoredUser(null), '');
  assert.equal(serializeStoredUser([]), '');
  assert.equal(serializeStoredUser({ value: 'x'.repeat(70 * 1024) }), '');
  assert.equal(parseStoredUser('invalid'), null);
  assert.equal(parseStoredUser('[1,2]'), null);
});
