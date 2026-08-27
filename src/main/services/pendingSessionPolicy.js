import { getBackoffDelayMs } from './offlineQueuePolicy.js';

const RETRYABLE_STATUS_CODES = new Set([408, 425, 429]);

export function isPendingSessionReady(pending, now = Date.now()) {
  if (!pending?.nextRetryAt) return true;
  const retryAt = Date.parse(pending.nextRetryAt);
  return !Number.isFinite(retryAt) || retryAt <= Number(now);
}

export function getPendingSessionKey(pending) {
  const type = pending?.type || 'offline-session';
  const identifier = type === 'stop-existing' ? pending?.sessionId : pending?.localId;
  return identifier ? `${type}:${identifier}` : null;
}

export function getSessionRetryAttempts(settings) {
  return Math.min(10, Math.max(1, Math.floor(Number(settings?.sync?.retryAttempts) || 3)));
}

export function buildStopSessionPayload(pending) {
  return pickDefined(pending, ['reason', 'notes', 'endTime', 'duration']);
}

export function buildOfflineSessionPayload(pending) {
  return pickDefined(pending, [
    'startTime',
    'endTime',
    'duration',
    'reason',
    'notes',
    'deviceInfo',
    'localId',
    'projectId',
    'taskId',
  ]);
}

export function getRemoteSessionId(response) {
  return response?.data?.data?._id || response?.data?.data?.sessionId || null;
}

export function schedulePendingSessionRetry(pending, error, now = Date.now()) {
  const retryCount = Math.max(0, Math.floor(Number(pending?.retryCount) || 0)) + 1;
  return {
    ...pending,
    retryCount,
    nextRetryAt: new Date(Number(now) + getBackoffDelayMs(retryCount)).toISOString(),
    lastError: error?.message || String(error || 'Error desconocido'),
  };
}

export function classifyPendingSessionError(error, pending) {
  const status = Number(error?.response?.status);

  if (!Number.isFinite(status)) return 'retry';
  if (status === 401) return 'hold';
  if (status === 409 && pending?.type !== 'stop-existing') return 'retry';
  if (RETRYABLE_STATUS_CODES.has(status) || status >= 500) return 'retry';

  return 'discard';
}

export function holdPendingSession(pending, error) {
  return {
    ...pending,
    nextRetryAt: null,
    lastError: error?.response?.data?.message || error?.message || String(error),
  };
}

function pickDefined(source, keys) {
  return Object.fromEntries(
    keys.filter(key => source?.[key] !== undefined).map(key => [key, source[key]]),
  );
}
