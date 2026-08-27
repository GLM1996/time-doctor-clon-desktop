import test from 'node:test';
import assert from 'node:assert/strict';
import { createSingleFlightRunner } from '../src/main/services/singleFlightRunner.js';

test('comparte sincronizaciones concurrentes del proceso principal', async () => {
  const run = createSingleFlightRunner();
  let calls = 0;
  let resolve;
  const operation = () => {
    calls += 1;
    return new Promise((done) => { resolve = done; });
  };
  const reconnect = run(operation);
  const healthy = run(operation);
  await Promise.resolve();
  assert.equal(calls, 1);
  resolve('synced');
  assert.deepEqual(await Promise.all([reconnect, healthy]), ['synced', 'synced']);
});

test('permite una nueva sincronizacion despues de exito o error', async () => {
  const run = createSingleFlightRunner();
  await run(async () => 'first');
  assert.equal(await run(async () => 'second'), 'second');
  await assert.rejects(run(async () => { throw new Error('offline'); }), /offline/);
  assert.equal(await run(async () => 'recovered'), 'recovered');
});
