export function normalizeUpdateCheckInterval(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric)
    ? Math.min(1440, Math.max(15, Math.floor(numeric)))
    : 60;
}

export function normalizeDownloadProgress(progress = {}) {
  return {
    percent: finiteBetween(progress.percent, 0, 100, 0),
    bytesPerSecond: finiteBetween(
      progress.bytesPerSecond,
      0,
      Number.MAX_SAFE_INTEGER,
      0,
    ),
    transferred: finiteBetween(
      progress.transferred,
      0,
      Number.MAX_SAFE_INTEGER,
      0,
    ),
    total: finiteBetween(progress.total, 0, Number.MAX_SAFE_INTEGER, 0),
  };
}

function finiteBetween(value, minimum, maximum, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.round(numeric)));
}
