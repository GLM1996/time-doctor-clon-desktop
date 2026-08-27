export function evaluateIdleState({
  systemIdleTime,
  idleThresholdSeconds,
  idleWarningSeconds,
  autoCloseInactiveSeconds,
  idleStartTime,
  warningSent,
  now = Date.now(),
}) {
  const idleSeconds = count(systemIdleTime);
  const threshold = count(idleThresholdSeconds);
  const warningAt = Math.max(threshold, count(idleWarningSeconds));
  const closeAt = Math.max(1, count(autoCloseInactiveSeconds));
  const currentTime = finiteTime(now);

  if (idleSeconds < threshold) {
    return {
      phase: 'active',
      idleDuration: 0,
      idleStartTime: null,
      secondsUntilClose: closeAt,
      shouldResetWarning: idleStartTime !== null || Boolean(warningSent),
      shouldWarn: false,
      shouldClose: false,
    };
  }

  const calculatedStart = idleStartTime !== null &&
    idleStartTime !== undefined &&
    Number.isFinite(Number(idleStartTime))
    ? Number(idleStartTime)
    : currentTime - idleSeconds * 1000;
  const elapsedFromStart = Math.max(0, Math.floor((currentTime - calculatedStart) / 1000));
  const idleDuration = Math.max(idleSeconds, elapsedFromStart);
  const shouldClose = idleDuration >= closeAt;
  const shouldWarn = idleDuration >= warningAt && !warningSent;

  return {
    phase: shouldClose ? 'close' : shouldWarn ? 'warning' : 'idle',
    idleDuration,
    idleStartTime: calculatedStart,
    secondsUntilClose: Math.max(0, closeAt - idleDuration),
    shouldResetWarning: false,
    shouldWarn,
    shouldClose,
  };
}

function count(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.floor(numeric)) : 0;
}

function finiteTime(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : Date.now();
}
