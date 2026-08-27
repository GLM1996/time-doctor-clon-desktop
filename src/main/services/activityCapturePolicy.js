export function shouldCreateActivitySnapshot({ monitoringActive, timerStatus } = {}) {
  return Boolean(
    monitoringActive &&
    timerStatus?.isRunning === true &&
    timerStatus?.isPaused !== true &&
    timerStatus?.sessionId,
  );
}
