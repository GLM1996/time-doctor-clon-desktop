import test from 'node:test';
import assert from 'node:assert/strict';
import { retryRequest } from '../src/main/services/retryRequest.js';

test('retryRequest devuelve el resultado en el primer intento exitoso', async () => {
  let calls = 0;
  const result = await retryRequest(() => {
    calls += 1;
    return 'ok';
  });
  assert.equal(result, 'ok');
  assert.equal(calls, 1);
});

test('retryRequest reintenta errores admitidos con espera incremental', async () => {
  const waits = [];
  let calls = 0;
  const result = await retryRequest(
    () => {
      calls += 1;
      if (calls < 3) throw new Error('network');
      return 'ok';
    },
    {
      attempts: 3,
      isRetryable: () => true,
      getDelayMs: attempt => attempt * 100,
      wait: async delay => waits.push(delay),
    },
  );
  assert.equal(result, 'ok');
  assert.deepEqual(waits, [100, 200]);
});

test('retryRequest no reintenta errores no recuperables', async () => {
  let calls = 0;
  await assert.rejects(
    retryRequest(
      () => {
        calls += 1;
        throw new Error('validation');
      },
      { attempts: 5, isRetryable: () => false, wait: async () => {} },
    ),
    /validation/,
  );
  assert.equal(calls, 1);
});

test('retryRequest limita intentos inválidos a uno', async () => {
  let calls = 0;
  await assert.rejects(
    retryRequest(() => {
      calls += 1;
      throw new Error('failure');
    }, { attempts: 0 }),
    /failure/,
  );
  assert.equal(calls, 1);
});
