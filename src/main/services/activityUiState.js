export function evaluateLowActivityAlert({
  percentage,
  threshold,
  totalMeasuredSeconds,
  warningSent,
  desktopNotificationsEnabled,
  lowActivityAlertEnabled,
}) {
  const activity = normalizePercentage(percentage);
  const limit = normalizePercentage(threshold);

  if (activity >= limit) {
    return { shouldNotify: false, shouldResetWarning: true, percentage: activity };
  }

  const shouldNotify =
    normalizeCount(totalMeasuredSeconds) >= 60 &&
    !warningSent &&
    desktopNotificationsEnabled !== false &&
    lowActivityAlertEnabled !== false;

  return { shouldNotify, shouldResetWarning: false, percentage: activity };
}

export function buildActivityUiUpdate({
  activityPercentage,
  status,
  trackActiveWindow,
  activeWindow,
  activeApp,
  systemIdleTime,
  activeTime,
  idleTime,
}) {
  const active = normalizeCount(activeTime);
  const idle = normalizeCount(idleTime);
  return {
    activityPercentage: normalizePercentage(activityPercentage),
    status: status || 'inactive',
    activeWindow: trackActiveWindow ? normalizeText(activeWindow) : null,
    activeApp: trackActiveWindow ? normalizeText(activeApp) : null,
    systemIdleTime: normalizeCount(systemIdleTime),
    activeTime: active,
    idleTime: idle,
    totalDuration: active + idle,
  };
}

function normalizePercentage(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.min(100, Math.max(0, Math.round(numeric))) : 0;
}

function normalizeCount(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.floor(numeric)) : 0;
}

function normalizeText(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text || null;
}
