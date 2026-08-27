import test from 'node:test';
import assert from 'node:assert/strict';
import { settleWithTimeout } from '../src/main/services/shutdownPolicy.js';

test('devuelve el resultado cuando la operacion termina a tiempo', async () => {
  assert.equal(await settleWithTimeout(Promise.resolve('done'), 100), 'done');
});

test('rechaza una operacion bloqueada dentro del limite configurado', async () => {
  const startedAt = Date.now();
  await assert.rejects(settleWithTimeout(new Promise(() => {}), 100, 'timeout'), /timeout/);
  assert.ok(Date.now() - startedAt < 1000);
});

test('propaga inmediatamente el error original de la operacion', async () => {
  await assert.rejects(settleWithTimeout(Promise.reject(new Error('failure')), 100), /failure/);
});
