// Only the server compares absolute times. Use elapsed monotonic time on the PC,
// whose wall clock may differ from the server or change during capture.
export function prepareOnDemandCapture(request, monotonicNow = performance.now()) {
  const remaining = Date.parse(request?.expiresAt) - Date.parse(request?.sentAt);
  return { ...request, localDeadline: Number.isFinite(remaining)
    ? monotonicNow + Math.max(0, Math.min(30000, remaining)) : undefined };
}

export function assertOnDemandCapture({ request, timerStatus, serviceActive, platform = process.platform, now = Date.now(), monotonicNow = performance.now() }) {
  if (platform !== 'win32') throw new Error('La captura bajo demanda solo está disponible en Windows');
  const expired = Number.isFinite(request?.localDeadline)
    ? request.localDeadline <= monotonicNow
    : !Number.isFinite(Date.parse(request?.expiresAt)) || Date.parse(request.expiresAt) <= now;
  if (!request?.requestId || expired) {
    throw new Error('La solicitud de captura ha caducado');
  }
  if (!serviceActive || !timerStatus?.isRunning || timerStatus.isPaused
      || !timerStatus.sessionId || String(timerStatus.sessionId) !== request.sessionId) {
    throw new Error('La sesión ya no está activa o las capturas están deshabilitadas');
  }
}
