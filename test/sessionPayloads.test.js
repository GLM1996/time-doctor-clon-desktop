import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDeviceInfo,
  buildPendingExistingStop,
  buildPendingOfflineSession,
  buildWorkSelection,
  createOfflineSession,
  normalizeStopInput,
} from '../src/main/services/sessionPayloads.js';

test('la información del dispositivo admite valores del runtime y reemplazos válidos', () => {
  const result = buildDeviceInfo(
    { hostname: 'custom' },
    { platform: 'win32', osVersion: '11', hostname: 'host', appVersion: '2.0.0' },
  );
  assert.deepEqual(result, {
    os: 'win32', osVersion: '11', hostname: 'custom', appVersion: '2.0.0',
  });
});

test('selección de trabajo y motivo de cierre se normalizan', () => {
  assert.deepEqual(buildWorkSelection({}), { projectId: null, taskId: null });
  assert.deepEqual(normalizeStopInput('manual', '  terminado  '), {
    reason: 'manual', notes: 'terminado',
  });
  assert.deepEqual(normalizeStopInput('invalid', 4), { reason: 'system', notes: null });
});

test('una sesión offline tiene identidad local y fecha deterministas', () => {
  const result = createOfflineSession(new Date('2026-08-13T12:00:00.000Z'), 'abc');
  assert.equal(result._id, 'offline-abc');
  assert.equal(result.startTime, '2026-08-13T12:00:00.000Z');
});

test('los cierres pendientes comparten duración y fecha normalizadas', () => {
  const input = {
    sessionId: 'session',
    startTime: '2026-08-13T11:00:00.000Z',
    endTime: new Date('2026-08-13T12:00:00.000Z'),
    duration: 25.9,
    reason: 'system',
    notes: null,
    activity: { activeTime: 18.9, idleTime: 7.8, pausedTime: 2, activitySnapshots: 3 },
  };
  const offline = buildPendingOfflineSession(input);
  const existing = buildPendingExistingStop(input);
  assert.equal(offline.duration, 25);
  assert.equal(offline.activeTime, 18);
  assert.equal(offline.idleTime, 7);
  assert.equal(offline.pausedTime, 2);
  assert.equal(offline.activitySnapshots, 3);
  assert.equal(existing.duration, 25);
  assert.equal(offline.createdAt, existing.createdAt);
});
