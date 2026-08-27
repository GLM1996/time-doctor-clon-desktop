const DEFAULTS = Object.freeze({
  screenshotIntervalMinutes: 5,
  screenshotQuality: 80,
  sampleIntervalSeconds: 60,
  idleThresholdMinutes: 5,
  lowActivityThreshold: 30,
  autoCloseInactiveMinutes: 10,
  maxOfflineDays: 7,
});

export function normalizeMonitoringSettings(settings = {}) {
  const screenshots = settings.screenshots || {};
  const activity = settings.activity || {};
  const sessions = settings.sessions || {};
  const notifications = settings.notifications || {};

  return {
    screenshots: {
      enabled: screenshots.enabled !== false,
      intervalMinutes: integerBetween(
        screenshots.intervalMinutes,
        1,
        60,
        DEFAULTS.screenshotIntervalMinutes,
      ),
      quality: integerBetween(screenshots.quality, 1, 100, DEFAULTS.screenshotQuality),
      maxWidth: integerBetween(screenshots.maxWidth, 640, 7680, 1920),
      maxHeight: integerBetween(screenshots.maxHeight, 480, 4320, 1080),
      maxFileSizeMB: numberBetween(screenshots.maxFileSizeMB, 1, 5, 5),
      blurSensitiveData: screenshots.blurSensitiveData === true,
    },
    activity: {
      enabled: activity.monitoringEnabled !== false,
      sampleIntervalSeconds: integerBetween(
        activity.sampleIntervalSeconds,
        10,
        600,
        DEFAULTS.sampleIntervalSeconds,
      ),
      idleThresholdMinutes: integerBetween(
        activity.idleThresholdMinutes,
        1,
        60,
        DEFAULTS.idleThresholdMinutes,
      ),
      lowActivityThreshold: integerBetween(
        activity.lowActivityThreshold,
        0,
        100,
        DEFAULTS.lowActivityThreshold,
      ),
      trackActiveWindow: activity.trackActiveWindow !== false,
      excludedDomains: Array.isArray(activity.excludedDomains) ? activity.excludedDomains : [],
      autoCloseInactiveMinutes: integerBetween(
        sessions.autoCloseInactiveMinutes,
        5,
        120,
        DEFAULTS.autoCloseInactiveMinutes,
      ),
      desktopNotificationsEnabled: notifications.desktopEnabled !== false,
      inactivityAlertEnabled: notifications.inactivityAlert !== false,
      lowActivityAlertEnabled: notifications.lowActivityAlert !== false,
    },
    offline: {
      maxOfflineDays: integerBetween(
        settings.sync?.maxOfflineDays,
        1,
        30,
        DEFAULTS.maxOfflineDays,
      ),
      maxPendingScreenshots: 500,
    },
  };
}

function integerAtLeast(value, minimum, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(minimum, Math.floor(numeric)) : fallback;
}

function integerBetween(value, minimum, maximum, fallback) {
  return Math.min(maximum, integerAtLeast(value, minimum, fallback));
}

function numberBetween(value, minimum, maximum, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric)
    ? Math.min(maximum, Math.max(minimum, numeric))
    : fallback;
}
