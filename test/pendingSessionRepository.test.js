import test from 'node:test';
import assert from 'node:assert/strict';
import PendingSessionRepository, {
  normalizePendingSessions,
} from '../src/main/services/pendingSessionRepository.js';

test('normalizePendingSessions migra el formato anterior y descarta entradas inválidas', () => {
  const legacy = {
    sessionId: 'offline-one',
    startTime: '2026-08-14T10:00:00.000Z',
    endTime: '2026-08-14T10:10:00.000Z',
    retryCount: -2,
  };
  assert.deepEqual(
    normalizePendingSessions([null, 'invalid', { sessionId: 'incomplete' }, legacy]),
    [{ ...legacy, localId: 'offline-one', retryCount: 0, type: 'offline-session', nextRetryAt: null }],
  );
});

test('descarta tipos desconocidos y deduplica operaciones por sesión', () => {
  const first = { type: 'stop-existing', sessionId: 'one', retryCount: 0 };
  const latest = { type: 'stop-existing', sessionId: 'one', retryCount: 2 };
  assert.deepEqual(
    normalizePendingSessions([first, { type: 'unknown', sessionId: 'two' }, latest]),
    [{ ...latest, nextRetryAt: null }],
  );
});

test('el repositorio devuelve una cola vacía cuando el archivo no existe', () => {
  const repository = new PendingSessionRepository({
    filePath: 'pending.json',
    storage: { readJson() {}, writeJson() {} },
    exists: () => false,
  });
  assert.deepEqual(repository.load(), []);
});

test('el repositorio normaliza la lectura y la escritura', () => {
  let saved;
  const repository = new PendingSessionRepository({
    filePath: 'pending.json',
    storage: {
      readJson: () => [{ type: 'stop-existing', sessionId: 'read', retryCount: '2.9' }],
      writeJson: (_path, value) => { saved = value; },
    },
    exists: () => true,
  });
  assert.equal(repository.load()[0].retryCount, 2);
  const normalized = repository.save([{ type: 'stop-existing', sessionId: 'write' }]);
  assert.deepEqual(saved, normalized);
  assert.equal(saved[0].type, 'stop-existing');
});

test('limita contadores y fechas de reintento corruptas', () => {
  const [item] = normalizePendingSessions([{
    type: 'stop-existing', sessionId: 'one', retryCount: 999999,
    nextRetryAt: '2099-01-01T00:00:00Z',
  }]);
  assert.equal(item.retryCount, 1000);
  assert.equal(item.nextRetryAt, null);
});
