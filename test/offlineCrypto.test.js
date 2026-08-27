import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  decryptOfflineBuffer,
  encryptOfflineBuffer,
  isEncryptedBuffer,
} from '../src/main/services/offlineCrypto.js';

test('AES-256-GCM cifra y recupera JSON y archivos binarios', () => {
  const key = crypto.randomBytes(32);
  const original = crypto.randomBytes(4096);
  const encrypted = encryptOfflineBuffer(original, key);

  assert.equal(isEncryptedBuffer(encrypted), true);
  assert.notDeepEqual(encrypted, original);
  assert.deepEqual(decryptOfflineBuffer(encrypted, key), original);
});

test('dos cifrados del mismo contenido no producen el mismo resultado', () => {
  const key = crypto.randomBytes(32);
  const original = Buffer.from('contenido sensible');

  assert.notDeepEqual(
    encryptOfflineBuffer(original, key),
    encryptOfflineBuffer(original, key),
  );
});

test('un archivo alterado se rechaza por autenticidad', () => {
  const key = crypto.randomBytes(32);
  const encrypted = encryptOfflineBuffer(Buffer.from('captura'), key);
  encrypted[encrypted.length - 1] ^= 1;

  assert.throws(() => decryptOfflineBuffer(encrypted, key));
});

test('una clave distinta no puede descifrar la cola', () => {
  const encrypted = encryptOfflineBuffer(
    Buffer.from('[{"sessionId":"offline-test"}]'),
    crypto.randomBytes(32),
  );

  assert.throws(() => decryptOfflineBuffer(encrypted, crypto.randomBytes(32)));
});
