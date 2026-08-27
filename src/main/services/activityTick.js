export function calculateTickDelta({ now, lastTickTime, suspensionThresholdSeconds = 15 }) {
  const current = Number(now);
  const previous = Number(lastTickTime);
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous <= 0) {
    return { seconds: 0, suspendedSeconds: 0 };
  }
  const elapsed = Math.floor((current - previous) / 1000);
  if (elapsed < 1) return { seconds: 0, suspendedSeconds: 0 };
  return elapsed > suspensionThresholdSeconds
    ? { seconds: 1, suspendedSeconds: elapsed }
    : { seconds: elapsed, suspendedSeconds: 0 };
}

export function advanceActivityWindow(window, hasRecentInput, seconds) {
  if (!Array.isArray(window) || window.length === 0) return [];
  const steps = Math.min(window.length, Math.max(0, Math.floor(Number(seconds) || 0)));
  if (steps === 0) return window.slice();
  return window.slice(steps).concat(new Array(steps).fill(Boolean(hasRecentInput)));
}

export function accumulateActivityTime({ activeTime, idleTime, hasRecentInput, seconds }) {
  const duration = Math.max(0, Math.floor(Number(seconds) || 0));
  return {
    activeTime: normalizeCount(activeTime) + (hasRecentInput ? duration : 0),
    idleTime: normalizeCount(idleTime) + (hasRecentInput ? 0 : duration),
  };
}

function normalizeCount(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.floor(numeric)) : 0;
}
