import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeActivityRuntimeOptions } from '../src/main/services/activityRuntimeOptions.js';

test('las opciones runtime usan valores predeterminados coherentes', () => {
  const result = normalizeActivityRuntimeOptions();
  assert.equal(result.reportIntervalSeconds, 60);
  assert.equal(result.idleThresholdSeconds, 300);
  assert.equal(result.autoCloseInactiveSeconds, 600);
  assert.equal(result.idleWarningSeconds, 480);
  assert.equal(result.lowActivityThreshold, 30);
});

test('la advertencia nunca ocurre antes del umbral de inactividad', () => {
  const result = normalizeActivityRuntimeOptions({
    idleThresholdMinutes: 9,
    autoCloseInactiveMinutes: 10,
  });
  assert.equal(result.idleThresholdSeconds, 540);
  assert.equal(result.idleWarningSeconds, 540);
});

test('las opciones runtime limitan valores y respetan desactivaciones explícitas', () => {
  const result = normalizeActivityRuntimeOptions({
    sampleIntervalSeconds: 2,
    lowActivityThreshold: 120,
    maxOfflineDays: 0,
    trackActiveWindow: false,
    desktopNotificationsEnabled: false,
  });
  assert.equal(result.reportIntervalSeconds, 10);
  assert.equal(result.lowActivityThreshold, 100);
  assert.equal(result.maxOfflineDays, 1);
  assert.equal(result.trackActiveWindow, false);
  assert.equal(result.desktopNotificationsEnabled, false);
});

test('las opciones runtime aplican los limites maximos del servidor', () => {
  const result = normalizeActivityRuntimeOptions({
    sampleIntervalSeconds: 900,
    idleThresholdMinutes: 120,
    autoCloseInactiveMinutes: 240,
    maxOfflineDays: 90,
  });
  assert.equal(result.reportIntervalSeconds, 600);
  assert.equal(result.idleThresholdSeconds, 3600);
  assert.equal(result.autoCloseInactiveSeconds, 7200);
  assert.equal(result.maxOfflineDays, 30);
});
