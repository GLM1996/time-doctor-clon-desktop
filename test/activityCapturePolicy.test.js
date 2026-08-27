import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldCreateActivitySnapshot } from '../src/main/services/activityCapturePolicy.js';

test('activity snapshots require active monitoring and a session', () => {
  assert.equal(shouldCreateActivitySnapshot({ monitoringActive: true, timerStatus: { isRunning: true, sessionId: 'session-1' } }), true);
  assert.equal(shouldCreateActivitySnapshot({ monitoringActive: false, timerStatus: { isRunning: true, sessionId: 'session-1' } }), false);
  assert.equal(shouldCreateActivitySnapshot({ monitoringActive: true, timerStatus: { isRunning: true, sessionId: null } }), false);
});

test('paused tracking cannot create new activity snapshots', () => {
  assert.equal(shouldCreateActivitySnapshot({ monitoringActive: true, timerStatus: { isRunning: true, isPaused: true, sessionId: 'session-1' } }), false);
});
