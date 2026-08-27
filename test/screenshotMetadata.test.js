import test from 'node:test';
import assert from 'node:assert/strict';
import { buildScreenshotMetadata } from '../src/main/services/screenshotMetadata.js';

test('los metadatos usan los campos reales del snapshot de actividad', () => {
  const result = buildScreenshotMetadata({
    activity: { activeWindow: ' Editor ', activeApp: 'Code', activityPercentage: 55 },
    capture: { width: 1920, height: 1080, displayIndex: 0, displayName: 'Main', isPrimary: true },
    sessionId: 'session', hostname: 'host', timestamp: '2026-08-13T12:00:00.000Z',
  });
  assert.equal(result.activeWindow, 'Editor');
  assert.equal(result.activeApp, 'Code');
  assert.equal(result.screenWidth, 1920);
  assert.equal(result.isPrimary, true);
});

test('ninguna captura fuerza actividad completa artificialmente', () => {
  const result = buildScreenshotMetadata({
    activity: { activityPercentage: 10, activeTime: -2, idleTime: 3.8 },
    firstCapture: true,
  });
  assert.equal(result.activityPercentage, 10);
  assert.equal(result.activeTime, 0);
  assert.equal(result.idleTime, 3);
});

test('los metadatos parciales se convierten en valores seguros', () => {
  const result = buildScreenshotMetadata({});
  assert.equal(result.sessionId, null);
  assert.equal(result.screenWidth, null);
  assert.equal(result.displayIndex, null);
  assert.equal(result.privacyBlurred, false);
});
