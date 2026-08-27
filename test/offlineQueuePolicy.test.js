import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getBackoffDelayMs,
  isOfflineItemReady,
  linkOfflineSnapshots,
  normalizeRetryAt,
  reconcileQueueAfterProcessing,
  pruneOfflineQueue,
  scheduleOfflineRetry,
} from '../src/main/services/offlineQueuePolicy.js';

test('normaliza fechas de reintento y rechaza aplazamientos anormales', () => {
  const now = Date.parse('2026-08-14T12:00:00.000Z');
  assert.equal(normalizeRetryAt('invalid', now), null);
  assert.equal(normalizeRetryAt('2099-01-01T00:00:00.000Z', now), null);
  assert.equal(
    normalizeRetryAt('2026-08-14T12:30:00.000Z', now),
    '2026-08-14T12:30:00.000Z',
  );
});

test('la reconciliación conserva altas y cambios concurrentes sin revivir eliminados', () => {
  const first = { id: 'first', sessionId: 'offline-one' };
  const second = { id: 'second', retryCount: 0 };
  const added = { id: 'added' };
  const result = reconcileQueueAfterProcessing({
    processingItems: [first, second],
    currentItems: [{ ...first, sessionId: 'remote-one' }, added],
    remainingItems: [first, { ...second, retryCount: 1 }],
    getId: item => item.id,
  });
  assert.deepEqual(result, [{ id: 'first', sessionId: 'remote-one' }, added]);
});

test('la reconciliación conserva el resultado de reintento cuando no hubo cambios paralelos', () => {
  const original = { id: 'one', retryCount: 0 };
  const result = reconcileQueueAfterProcessing({
    processingItems: [original],
    currentItems: [original],
    remainingItems: [{ ...original, retryCount: 1 }],
    getId: item => item.id,
  });
  assert.equal(result[0].retryCount, 1);
});

test('el backoff crece exponencialmente y se limita a una hora', () => {
  assert.equal(getBackoffDelayMs(1), 30_000);
  assert.equal(getBackoffDelayMs(2), 60_000);
  assert.equal(getBackoffDelayMs(3), 120_000);
  assert.equal(getBackoffDelayMs(99), 3_600_000);
});

test('el ciclo offline enlaza la sesión remota sin perder ni duplicar snapshots', () => {
  const queue = [
    { clientEventId: 'event-1', localSessionId: 'offline-1', sessionId: null },
    { clientEventId: 'event-2', localSessionId: 'offline-1', sessionId: null },
    { clientEventId: 'other', localSessionId: 'offline-2', sessionId: null },
  ];

  const linked = linkOfflineSnapshots(queue, 'offline-1', 'remote-1');
  assert.equal(linked.replacements, 2);
  assert.deepEqual(
    linked.items.slice(0, 2).map((item) => [item.clientEventId, item.sessionId, item.localSessionId]),
    [
      ['event-1', 'remote-1', null],
      ['event-2', 'remote-1', null],
    ],
  );
  assert.equal(linked.items[2], queue[2]);
  assert.equal(new Set(linked.items.map((item) => item.clientEventId)).size, 3);
});

test('un fallo programa reintento y no se procesa antes de tiempo', () => {
  const now = Date.parse('2026-08-13T12:00:00.000Z');
  const pending = scheduleOfflineRetry(
    { clientEventId: 'event-1', sessionId: 'remote-1', retryCount: 0 },
    now,
  );

  assert.equal(pending.retryCount, 1);
  assert.equal(isOfflineItemReady(pending, now), false);
  assert.equal(isOfflineItemReady(pending, now + 30_000), true);
  assert.equal(isOfflineItemReady({ ...pending, sessionId: null }, now + 30_000), false);
});

test('la cola elimina datos expirados y conserva los mas recientes dentro del limite', () => {
  const recent = new Date().toISOString();
  const expired = new Date(Date.now() - 10 * 86400000).toISOString();
  const result = pruneOfflineQueue([
    { id: 'expired', createdAt: expired },
    { id: 'one', createdAt: recent },
    { id: 'two', createdAt: recent },
    { id: 'three', createdAt: recent },
  ], { maxOfflineDays: 7, maxItems: 2 });

  assert.deepEqual(result.map(item => item.id), ['two', 'three']);
});

test('la retencion offline nunca supera treinta dias', () => {
  const recent = new Date().toISOString();
  const tooOld = new Date(Date.now() - 31 * 86400000).toISOString();
  const result = pruneOfflineQueue([
    { id: 'too-old', createdAt: tooOld },
    { id: 'recent', createdAt: recent },
  ], { maxOfflineDays: 999 });

  assert.deepEqual(result.map(item => item.id), ['recent']);
});

test('la cola generica nunca admite mas de diez mil elementos', () => {
  const createdAt = new Date().toISOString();
  const items = Array.from({ length: 10001 }, (_, id) => ({ id, createdAt }));
  const result = pruneOfflineQueue(items, { maxItems: 999999 });

  assert.equal(result.length, 10000);
  assert.equal(result[0].id, 1);
});
