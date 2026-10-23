export function assertOnDemandCapture({ request, timerStatus, serviceActive, platform = process.platform, now = Date.now() }) {
  if (platform !== 'win32') throw new Error('La captura bajo demanda solo está disponible en Windows');
  if (!request?.requestId || !Number.isFinite(Date.parse(request.expiresAt)) || Date.parse(request.expiresAt) <= now) {
    throw new Error('La solicitud de captura ha caducado');
  }
  if (!serviceActive || !timerStatus?.isRunning || timerStatus.isPaused
      || !timerStatus.sessionId || String(timerStatus.sessionId) !== request.sessionId) {
    throw new Error('La sesión ya no está activa o las capturas están deshabilitadas');
  }
}
