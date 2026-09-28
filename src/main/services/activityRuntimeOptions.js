import { normalizeExcludedDomains } from './activeDomain.js';

export function normalizeActivityRuntimeOptions(options = {}) {
  const reportIntervalSeconds = integerBetween(options.sampleIntervalSeconds, 10, 600, 60);
  const autoCloseInactiveSeconds =
    integerBetween(options.autoCloseInactiveMinutes, 2, 120, 5) * 60;
  // La alerta aparece un minuto antes del cierre. Este umbral derivado también
  // determina desde cuándo el intervalo se considera inactivo; el antiguo
  // idleThresholdMinutes se conserva en el servidor solo por compatibilidad.
  const idleWarningSeconds = Math.max(60, autoCloseInactiveSeconds - 60);

  return {
    reportIntervalSeconds,
    idleThresholdSeconds: idleWarningSeconds,
    autoCloseInactiveSeconds,
    idleWarningSeconds,
    lowActivityThreshold: integerBetween(options.lowActivityThreshold, 0, 100, 30),
    maxOfflineDays: integerBetween(options.maxOfflineDays, 1, 30, 7),
    trackActiveWindow: options.trackActiveWindow !== false,
    excludedDomains: normalizeExcludedDomains(options.excludedDomains),
    desktopNotificationsEnabled: options.desktopNotificationsEnabled !== false,
    inactivityAlertEnabled: options.inactivityAlertEnabled !== false,
    lowActivityAlertEnabled: options.lowActivityAlertEnabled !== false,
  };
}

function integerAtLeast(value, minimum, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(minimum, Math.floor(numeric)) : fallback;
}

function integerBetween(value, minimum, maximum, fallback) {
  return Math.min(maximum, integerAtLeast(value, minimum, fallback));
}
