export function buildScreenshotMetadata({
  activity = {},
  capture = {},
  sessionId,
  hostname,
  timestamp = new Date().toISOString(),
}) {
  return {
    timestamp,
    sessionId: sessionId || null,
    activeWindow: normalizeText(activity.activeWindow),
    activeApp: normalizeText(activity.activeApp),
    activityPercentage: percentage(activity.activityPercentage),
    totalDuration: count(activity.totalDuration),
    activeTime: count(activity.activeTime),
    idleTime: count(activity.idleTime),
    hostname: normalizeText(hostname),
    screenWidth: positiveCount(capture.width),
    screenHeight: positiveCount(capture.height),
    displayIndex: capture.displayIndex ?? null,
    displayName: normalizeText(capture.displayName),
    isPrimary: capture.isPrimary === true,
    privacyBlurred: capture.privacyBlurred === true,
  };
}

function normalizeText(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text ? text.slice(0, 500) : null;
}

function count(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.floor(numeric)) : 0;
}

function positiveCount(value) {
  const normalized = count(value);
  return normalized > 0 ? normalized : null;
}

function percentage(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.min(100, Math.max(0, Math.round(numeric))) : 0;
}
