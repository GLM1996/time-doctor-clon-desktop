import test from 'node:test';
import assert from 'node:assert/strict';
import { buildActivityUiUpdate, evaluateLowActivityAlert } from '../src/main/services/activityUiState.js';

test('la alerta de baja actividad no aparece durante el primer minuto', () => {
  const result = evaluateLowActivityAlert({
    percentage: 10, threshold: 30, totalMeasuredSeconds: 59,
    warningSent: false, desktopNotificationsEnabled: true, lowActivityAlertEnabled: true,
  });
  assert.equal(result.shouldNotify, false);
});

test('la alerta se emite una vez y se rearma al recuperar actividad', () => {
  const base = {
    percentage: 10, threshold: 30, totalMeasuredSeconds: 60,
    warningSent: false, desktopNotificationsEnabled: true, lowActivityAlertEnabled: true,
  };
  assert.equal(evaluateLowActivityAlert(base).shouldNotify, true);
  assert.equal(evaluateLowActivityAlert({ ...base, warningSent: true }).shouldNotify, false);
  assert.equal(evaluateLowActivityAlert({ ...base, percentage: 40 }).shouldResetWarning, true);
});

test('el evento de actividad normaliza métricas y oculta ventanas si está desactivado', () => {
  const result = buildActivityUiUpdate({
    activityPercentage: 120, status: 'active', trackActiveWindow: false,
    activeWindow: 'Editor', activeApp: 'Code', systemIdleTime: -2,
    activeTime: 5.9, idleTime: 3.2,
  });
  assert.equal(result.activityPercentage, 100);
  assert.equal(result.activeWindow, null);
  assert.equal(result.systemIdleTime, 0);
  assert.equal(result.totalDuration, 8);
});
