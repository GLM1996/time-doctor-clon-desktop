export function getScreenshotConfigTransition({ oldConfig, newConfig, isCapturing, trackingActive }) {
  const previous = oldConfig?.screenshots || {};
  const next = newConfig?.screenshots || {};
  const intervalMinutes = normalizeInterval(next.intervalMinutes);
  const intervalChanged = normalizeInterval(previous.intervalMinutes) !== intervalMinutes;
  if (!trackingActive || next.enabled === false) {
    return { action: isCapturing ? 'stop' : 'none', intervalMinutes };
  }
  if (!isCapturing || intervalChanged) return { action: 'restart', intervalMinutes };
  return { action: 'none', intervalMinutes };
}

function normalizeInterval(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(1, Math.floor(numeric)) : 5;
}
