import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMonitoringSettings } from '../src/main/services/monitoringSettings.js';

test('la configuración de monitoreo aplica valores predeterminados seguros', () => {
  const result = normalizeMonitoringSettings();
  assert.equal(result.screenshots.intervalMinutes, 5);
  assert.equal(result.screenshots.quality, 80);
  assert.equal(result.activity.sampleIntervalSeconds, 60);
  assert.equal(result.activity.autoCloseInactiveMinutes, 10);
  assert.equal(result.offline.maxOfflineDays, 7);
});

test('la configuración limita intervalos, calidad y umbrales inválidos', () => {
  const result = normalizeMonitoringSettings({
    screenshots: { intervalMinutes: 0, quality: 200 },
    activity: { sampleIntervalSeconds: 2, lowActivityThreshold: -8 },
    sessions: { autoCloseInactiveMinutes: 0 },
    sync: { maxOfflineDays: -2 },
  });
  assert.equal(result.screenshots.intervalMinutes, 1);
  assert.equal(result.screenshots.quality, 100);
  assert.equal(result.activity.sampleIntervalSeconds, 10);
  assert.equal(result.activity.lowActivityThreshold, 0);
  assert.equal(result.activity.autoCloseInactiveMinutes, 5);
  assert.equal(result.offline.maxOfflineDays, 1);
});

test("limita configuraciones legacy a los máximos aceptados por el backend", () => {
  const result = normalizeMonitoringSettings({
    screenshots: { intervalMinutes: 500 },
    activity: { sampleIntervalSeconds: 900, idleThresholdMinutes: 120 },
    sessions: { autoCloseInactiveMinutes: 1440 },
    sync: { maxOfflineDays: 90 },
  });
  assert.equal(result.screenshots.intervalMinutes, 60);
  assert.equal(result.activity.sampleIntervalSeconds, 600);
  assert.equal(result.activity.idleThresholdMinutes, 60);
  assert.equal(result.activity.autoCloseInactiveMinutes, 120);
  assert.equal(result.offline.maxOfflineDays, 30);
  assert.equal(result.screenshots.maxWidth, 1920);
  assert.equal(result.screenshots.maxHeight, 1080);
  assert.equal(result.screenshots.maxFileSizeMB, 5);
});

test("normaliza dimensiones y tamaño de captura", () => {
  const result = normalizeMonitoringSettings({
    screenshots: { maxWidth: 200, maxHeight: 9000, maxFileSizeMB: 20 },
  });
  assert.equal(result.screenshots.maxWidth, 640);
  assert.equal(result.screenshots.maxHeight, 4320);
  assert.equal(result.screenshots.maxFileSizeMB, 5);
});

test('las opciones booleanas solo se desactivan explícitamente', () => {
  const result = normalizeMonitoringSettings({
    screenshots: { enabled: false, blurSensitiveData: true },
    activity: { monitoringEnabled: false, trackActiveWindow: false },
    notifications: { desktopEnabled: false, inactivityAlert: false },
  });
  assert.equal(result.screenshots.enabled, false);
  assert.equal(result.screenshots.blurSensitiveData, true);
  assert.equal(result.activity.enabled, false);
  assert.equal(result.activity.trackActiveWindow, false);
  assert.equal(result.activity.desktopNotificationsEnabled, false);
  assert.equal(result.activity.inactivityAlertEnabled, false);
});
