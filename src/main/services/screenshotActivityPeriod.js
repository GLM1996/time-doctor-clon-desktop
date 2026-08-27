export function createActivityBaseline(snapshot = {}) {
  return {
    activeTime: seconds(snapshot.activeTime),
    idleTime: seconds(snapshot.idleTime),
  };
}

export function calculatePeriodActivity(snapshot = {}, baseline = null) {
  const current = createActivityBaseline(snapshot);
  if (!baseline) return { percentage: 0, baseline: current, measuredSeconds: 0 };

  const activeSeconds = Math.max(0, current.activeTime - seconds(baseline.activeTime));
  const idleSeconds = Math.max(0, current.idleTime - seconds(baseline.idleTime));
  const measuredSeconds = activeSeconds + idleSeconds;
  const percentage = measuredSeconds
    ? Math.round((activeSeconds / measuredSeconds) * 100)
    : 0;

  return { percentage, baseline: current, measuredSeconds };
}

function seconds(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.floor(numeric)) : 0;
}
