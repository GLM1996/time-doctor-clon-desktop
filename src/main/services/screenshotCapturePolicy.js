export function shouldCaptureScreenshot({ serviceActive, timerStatus } = {}) {
  return Boolean(serviceActive && timerStatus?.isRunning === true && timerStatus?.isPaused !== true);
}

export function shouldQueueScreenshotForLater({ sessionId, hasToken } = {}) {
  return !hasToken || String(sessionId || '').startsWith('offline-');
}

export function constrainScreenshotDimensions({ width, height, maxWidth, maxHeight } = {}) {
  const sourceWidth = Math.max(1, Math.floor(Number(width) || 1));
  const sourceHeight = Math.max(1, Math.floor(Number(height) || 1));
  const widthLimit = Math.max(1, Math.floor(Number(maxWidth) || sourceWidth));
  const heightLimit = Math.max(1, Math.floor(Number(maxHeight) || sourceHeight));
  const scale = Math.min(1, widthLimit / sourceWidth, heightLimit / sourceHeight);

  return {
    width: Math.max(1, Math.floor(sourceWidth * scale)),
    height: Math.max(1, Math.floor(sourceHeight * scale)),
    resized: scale < 1,
  };
}
