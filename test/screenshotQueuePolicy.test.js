import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createScreenshotQueueItem,
  evaluateScreenshotQueueItem,
  linkScreenshotSession,
  normalizeScreenshotQueue,
  normalizeScreenshotQueueItem,
  scheduleScreenshotRetry,
} from '../src/main/services/screenshotQueuePolicy.js';

test('createScreenshotQueueItem crea una operación normalizada', () => {
  const item = createScreenshotQueueItem({
    filePath: 'capture.bin', metadata: { sessionId: 'one' }, errorMessage: 'network',
    now: new Date('2026-08-13T12:00:00Z'), id: 'pending-one',
  });
  assert.equal(item.retryCount, 0);
  assert.equal(item.metadata.clientCaptureId, item.id);
  assert.equal(item.maxRetries, 5);
  assert.equal(item.nextRetryAt, null);
});

test('la cola normalizada conserva una sola versión por identificador', () => {
  const queue = normalizeScreenshotQueue([
    { id: 'one', filePath: 'old', retryCount: 0 },
    { id: 'one', filePath: 'new', retryCount: 2 },
    null,
  ]);
  assert.equal(queue.length, 1);
  assert.equal(queue[0].filePath, 'new');
  assert.equal(queue[0].retryCount, 2);
});

test('la evaluación distingue espera, descarte y subida', () => {
  const now = Date.parse('2026-08-13T12:00:00Z');
  assert.equal(evaluateScreenshotQueueItem({ filePath: 'one', nextRetryAt: '2026-08-13T12:01:00Z' }, now).action, 'wait');
  assert.equal(evaluateScreenshotQueueItem({ filePath: 'one', retryCount: 5, maxRetries: 5 }, now).action, 'discard');
  assert.equal(evaluateScreenshotQueueItem({ filePath: null }, now).reason, 'missing-file');
  assert.equal(
    evaluateScreenshotQueueItem({ filePath: 'one', metadata: { sessionId: 'offline-one' } }, now).reason,
    'pending-session',
  );
  assert.equal(evaluateScreenshotQueueItem({ filePath: 'one' }, now).action, 'upload');
});

test('las capturas offline se enlazan con la sesión remota antes de subir', () => {
  const original = [
    { id: 'one', metadata: { sessionId: 'offline-one', displayIndex: 0 } },
    { id: 'two', metadata: { sessionId: 'remote-two' } },
  ];
  const linked = linkScreenshotSession(original, 'offline-one', 'remote-one');
  assert.equal(linked.replacements, 1);
  assert.equal(linked.items[0].metadata.sessionId, 'remote-one');
  assert.equal(linked.items[0].metadata.displayIndex, 0);
  assert.equal(linked.items[1], original[1]);
});

test('la normalización evita reintentos ilimitados del formato heredado', () => {
  const item = normalizeScreenshotQueueItem({ filePath: 'one', retryCount: -3 });
  assert.match(item.id, /^legacy-[a-f0-9]{32}$/);
  assert.equal(item.retryCount, 0);
  assert.equal(item.maxRetries, 5);
});

test('la normalizacion limita los reintentos declarados por datos heredados', () => {
  const item = normalizeScreenshotQueueItem({ filePath: 'one', maxRetries: 999 });
  assert.equal(item.maxRetries, 10);
});

test('el identificador migrado permanece estable entre reinicios', () => {
  const legacy = { filePath: 'one', createdAt: '2026-08-14T10:00:00.000Z' };
  assert.equal(
    normalizeScreenshotQueueItem(legacy).id,
    normalizeScreenshotQueueItem(legacy).id,
  );
});

test('scheduleScreenshotRetry incrementa contador y aplica backoff', () => {
  const item = scheduleScreenshotRetry({ filePath: 'one', retryCount: 0 }, new Error('fallo'), 0);
  assert.equal(item.retryCount, 1);
  assert.equal(item.nextRetryAt, '1970-01-01T00:00:30.000Z');
  assert.equal(item.errorMessage, 'fallo');
});
