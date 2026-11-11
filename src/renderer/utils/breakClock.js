// Absolute time comes from main's server-synchronized clock. The renderer only
// advances the displayed duration with its monotonic timer.
export function getBreakElapsedAtObservation(activeBreak) {
  const explicitStart = Date.parse(activeBreak?.startTime);
  const serverNow = Date.parse(activeBreak?.serverNow);
  const expiresAt = Date.parse(activeBreak?.expiresAt);
  const maxMinutes = Number(activeBreak?.type?.maxMinutes) || 0;
  const start = Number.isFinite(explicitStart)
    ? explicitStart
    : Number.isFinite(expiresAt) && maxMinutes > 0
      ? expiresAt - maxMinutes * 60000
      : serverNow;
  return Number.isFinite(serverNow) && Number.isFinite(start)
    ? Math.max(0, Math.floor((serverNow - start) / 1000))
    : 0;
}
