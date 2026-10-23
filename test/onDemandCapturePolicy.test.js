import test from 'node:test';
import assert from 'node:assert/strict';
import { assertOnDemandCapture } from '../src/main/services/onDemandCapturePolicy.js';

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
