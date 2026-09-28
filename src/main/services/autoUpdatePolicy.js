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

export function isVersionNewer(candidate, current) {
  const candidateParts = parseVersion(candidate);
  const currentParts = parseVersion(current);
  if (!candidateParts || !currentParts) return false;
  for (let index = 0; index < 3; index += 1) {
    if (candidateParts[index] !== currentParts[index]) {
      return candidateParts[index] > currentParts[index];
    }
  }
  return false;
}

function parseVersion(value) {
  const match = String(value || "").trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/i);
  return match ? match.slice(1, 4).map(Number) : null;
}

function finiteBetween(value, minimum, maximum, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.round(numeric)));
}
