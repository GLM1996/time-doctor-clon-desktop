import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePendingSessions } from '../src/main/services/pendingSessionRepository.js';
import {
  buildStopBreakPayload,
  getPendingSessionKey,
} from '../src/main/services/pendingSessionPolicy.js';

test('persiste y deduplica el cierre offline de una pausa', () => {
  const first = {
    type: 'stop-break',
    breakId: 'break-one',
    endedAt: '2026-09-22T13:00:00.000Z',
  };
  const latest = { ...first, retryCount: 1 };
  assert.deepEqual(normalizePendingSessions([first, latest]), [
    { ...latest, nextRetryAt: null },
  ]);
});

test('genera una clave y payload estables para sincronizar la pausa', () => {
  const pending = {
    type: 'stop-break',
    breakId: 'break-one',
    endedAt: '2026-09-22T13:00:00.000Z',
    extra: true,
  };
  assert.equal(getPendingSessionKey(pending), 'stop-break:break-one');
  assert.deepEqual(buildStopBreakPayload(pending), {
    endedAt: '2026-09-22T13:00:00.000Z',
  });
});
