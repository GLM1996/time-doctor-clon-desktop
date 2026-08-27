const RETRYABLE_STATUSES = new Set([408, 425, 429]);

export function isRetryableScreenshotUploadError(error) {
  const status = Number(error?.response?.status);
  if (!Number.isFinite(status)) return true;
  return RETRYABLE_STATUSES.has(status) || status >= 500;
}
