export function shouldApplyProbeResult(startRevision, currentRevision) {
  const started = Number(startRevision);
  const current = Number(currentRevision);
  return Number.isSafeInteger(started) && Number.isSafeInteger(current) && started === current;
}
