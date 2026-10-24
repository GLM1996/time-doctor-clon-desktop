import test from 'node:test';
import assert from 'node:assert/strict';
import { assertOnDemandCapture, prepareOnDemandCapture } from '../src/main/services/onDemandCapturePolicy.js';

const base = { request: { requestId: 'request', sessionId: 'session', expiresAt: '2026-10-23T15:00:30Z' },
  timerStatus: { isRunning: true, isPaused: false, sessionId: 'session' }, serviceActive: true,
  platform: 'win32', now: Date.parse('2026-10-23T15:00:00Z') };
test('solo ejecuta la orden vigente en Windows y en la sesión indicada', () => {
  assert.doesNotThrow(() => assertOnDemandCapture(base));
  for (const platform of ['darwin', 'linux']) assert.throws(() => assertOnDemandCapture({ ...base, platform }));
  for (const timerStatus of [{ ...base.timerStatus, isRunning: false }, { ...base.timerStatus, isPaused: true }, { ...base.timerStatus, sessionId: 'other' }]) {
    assert.throws(() => assertOnDemandCapture({ ...base, timerStatus }));
  }
  assert.throws(() => assertOnDemandCapture({ ...base, serviceActive: false }));
  assert.throws(() => assertOnDemandCapture({ ...base, now: Date.parse(base.request.expiresAt) }));
  assert.throws(() => assertOnDemandCapture({ ...base, request: {} }));
});

test('la caducidad usa tiempo transcurrido aunque el reloj del PC esté desajustado', () => {
  const request = prepareOnDemandCapture({ ...base.request, sentAt: '2026-10-23T15:00:00Z' }, 1000);
  for (const offset of [-3600000, 3600000]) {
    assert.doesNotThrow(() => assertOnDemandCapture({ ...base, request, now: base.now + offset, monotonicNow: 1001 }));
    assert.throws(() => assertOnDemandCapture({ ...base, request, now: base.now + offset, monotonicNow: 31000 }), /caducado/);
  }
});

test('respeta el tiempo restante del servidor y conserva compatibilidad con servidores anteriores', () => {
  const request = prepareOnDemandCapture({ ...base.request, sentAt: base.request.expiresAt }, 1000);
  assert.throws(() => assertOnDemandCapture({ ...base, request, monotonicNow: 1000 }), /caducado/);
  const legacy = prepareOnDemandCapture(base.request, 1000);
  assert.doesNotThrow(() => assertOnDemandCapture({ ...base, request: legacy }));
  assert.throws(() => assertOnDemandCapture({ ...base, request: legacy, now: Date.parse(base.request.expiresAt) }), /caducado/);
});
