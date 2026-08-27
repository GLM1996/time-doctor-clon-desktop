import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createActivitySnapshot,
  toActivityApiPayload,
} from '../src/main/services/activitySnapshot.js';

test('createActivitySnapshot separa sesiones locales de remotas', () => {
  const offline = createActivitySnapshot({
    sessionId: 'offline-one', isOffline: true, activeTime: 10, idleTime: 5,
    now: new Date('2026-08-13T12:00:00Z'), clientEventId: 'event',
  });
  assert.equal(offline.sessionId, null);
  assert.equal(offline.localSessionId, 'offline-one');
  assert.equal(offline.totalDuration, 15);

  const online = createActivitySnapshot({ sessionId: 'remote', isOffline: false });
  assert.equal(online.sessionId, 'remote');
  assert.equal(online.localSessionId, null);
});

test('toActivityApiPayload normaliza métricas, intervalo y textos', () => {
  const payload = toActivityApiPayload({
    sessionId: 'one', activityPercentage: 150, keyboardEvents: -2,
    intervalSeconds: 500, activeWindow: `  ${'a'.repeat(250)}  `,
  }, { clientEventId: 'event' });
  assert.equal(payload.activityPercentage, 100);
  assert.equal(payload.keyboardEvents, 0);
  assert.equal(payload.intervalSeconds, 120);
  assert.equal(payload.activeWindow.length, 200);
  assert.equal(payload.clientEventId, 'event');
});

test('toActivityApiPayload no modifica el snapshot original', () => {
  const snapshot = { sessionId: 'one' };
  toActivityApiPayload(snapshot, { clientEventId: 'generated' });
  assert.equal(snapshot.clientEventId, undefined);
});
