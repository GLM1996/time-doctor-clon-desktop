import { formatDuration } from './timerServiceUtils.js';

export function buildTimerStatus({
  isRunning,
  currentBreakId,
  isOffline,
  sessionId,
  startTime,
  elapsedSeconds,
  pendingOperations,
  sync,
  config,
}) {
  const elapsed = normalizeCount(elapsedSeconds);
  return {
    isRunning: Boolean(isRunning),
    isPaused: Boolean(currentBreakId),
    currentBreakId: currentBreakId || null,
    isOffline: Boolean(isOffline),
    sessionId: sessionId || null,
    startTime: startTime || null,
    elapsedSeconds: elapsed,
    elapsedFormatted: formatDuration(elapsed),
    pendingOperations: normalizeCount(pendingOperations),
    sync: sync || null,
    config: config || null,
  };
}

export function buildTimerUpdate({
  isRunning,
  currentBreakId,
  isOffline,
  elapsedSeconds,
  sessionId,
}) {
  const elapsed = normalizeCount(elapsedSeconds);
  return {
    isRunning: Boolean(isRunning),
    isPaused: Boolean(currentBreakId),
    isOffline: Boolean(isOffline),
    elapsedSeconds: elapsed,
    elapsedFormatted: formatDuration(elapsed),
    sessionId: sessionId || null,
  };
}

function normalizeCount(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.floor(numeric)) : 0;
}
