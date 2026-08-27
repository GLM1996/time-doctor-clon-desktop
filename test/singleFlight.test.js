import test from 'node:test';
import assert from 'node:assert/strict';
import { runSingleFlight } from '../src/renderer/utils/singleFlight.js';

test('comparte una operacion concurrente con todos sus consumidores', async () => {
  let calls = 0;
  let resolve;
  const operation = () => {
    calls += 1;
    return new Promise((done) => { resolve = done; });
  };
  const first = runSingleFlight('shared-success', operation);
  const second = runSingleFlight('shared-success', operation);
  await Promise.resolve();
  assert.equal(calls, 1);
  resolve('done');
  assert.deepEqual(await Promise.all([first, second]), ['done', 'done']);
});

test('libera la clave despues de completar o fallar', async () => {
  await runSingleFlight('released-success', async () => 'one');
  assert.equal(await runSingleFlight('released-success', async () => 'two'), 'two');
  await assert.rejects(runSingleFlight('released-error', async () => { throw new Error('failure'); }));
  assert.equal(await runSingleFlight('released-error', async () => 'recovered'), 'recovered');
});
