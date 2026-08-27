import test from 'node:test';
import assert from 'node:assert/strict';
import ActivityQueueRepository, {
  normalizeAndPrune,
} from '../src/main/services/activityQueueRepository.js';

test('normalizeAndPrune descarta entradas inválidas y normaliza reintentos', () => {
  const timestamp = new Date().toISOString();
  const result = normalizeAndPrune([
    null,
    'invalid',
    { timestamp, retryCount: 0 },
    { sessionId: 'remote-one', timestamp, retryCount: -4 },
  ]);
  assert.equal(result.length, 1);
  assert.equal(result[0].sessionId, 'remote-one');
  assert.match(result[0].clientEventId, /^legacy-[a-f0-9]{32}$/);
  assert.equal(result[0].retryCount, 0);
  assert.equal(result[0].nextRetryAt, null);
});

test('normalizeAndPrune respeta el límite máximo de snapshots', () => {
  const timestamp = new Date().toISOString();
  const result = normalizeAndPrune(
    [1, 2, 3].map(id => ({ clientEventId: `event-${id}`, sessionId: 'remote', timestamp })),
    { maxActivitySnapshots: 2 },
  );
  assert.deepEqual(result.map(item => item.clientEventId), ['event-2', 'event-3']);
});

test('la migración es determinista y elimina eventos duplicados', () => {
  const timestamp = new Date().toISOString();
  const legacy = { localSessionId: 'offline-one', timestamp, activityPercentage: 50 };
  const first = normalizeAndPrune([legacy])[0];
  const second = normalizeAndPrune([legacy, legacy]);
  assert.equal(second.length, 1);
  assert.equal(second[0].clientEventId, first.clientEventId);
});

test('el repositorio cifra a través del storage y devuelve la cola guardada', () => {
  let saved;
  const repository = new ActivityQueueRepository({
    filePath: 'activity.json',
    exists: () => true,
    storage: {
      readJson: () => [],
      writeJson: (_path, value) => { saved = value; },
    },
  });
  const result = repository.save([{
    clientEventId: 'one', sessionId: 'remote', timestamp: new Date().toISOString(),
  }]);
  assert.deepEqual(saved, result);
  assert.equal(repository.load().length, 0);
});

test('normaliza estados de reintento heredados o corruptos', () => {
  const timestamp = new Date().toISOString();
  const [item] = normalizeAndPrune([{
    sessionId: 'remote', timestamp, retryCount: 999999, nextRetryAt: '2099-01-01T00:00:00Z',
  }]);
  assert.equal(item.retryCount, 1000);
  assert.equal(item.nextRetryAt, null);
});
