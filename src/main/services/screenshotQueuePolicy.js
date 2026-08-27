import { createHash, randomUUID } from 'node:crypto';
import { getBackoffDelayMs, normalizeRetryAt } from './offlineQueuePolicy.js';

export function createScreenshotQueueItem({
  filePath,
  metadata,
  errorMessage,
  now = new Date(),
  id = `pending-${randomUUID()}`,
  maxRetries = 5,
}) {
  return {
    id,
    filePath: filePath || null,
    metadata: {
      ...(metadata && typeof metadata === 'object' ? metadata : {}),
      clientCaptureId: validQueueId(metadata?.clientCaptureId)
        ? metadata.clientCaptureId.trim()
        : id,
    },
    errorMessage: String(errorMessage || 'Unknown error').slice(0, 1000),
    retryCount: 0,
    maxRetries: positiveInteger(maxRetries, 5, 10),
    nextRetryAt: null,
    createdAt: toIsoString(now),
  };
}

export function normalizeScreenshotQueueItem(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
  const id = validQueueId(item.id) ? item.id.trim() : buildLegacyQueueId(item);
  return {
    ...item,
    id,
    metadata: {
      ...(item.metadata && typeof item.metadata === 'object' ? item.metadata : {}),
      clientCaptureId: validQueueId(item.metadata?.clientCaptureId)
        ? item.metadata.clientCaptureId.trim()
        : id,
    },
    retryCount: Math.min(1000, nonNegativeInteger(item.retryCount)),
    maxRetries: positiveInteger(item.maxRetries, 5, 10),
    nextRetryAt: normalizeRetryAt(item.nextRetryAt),
  };
}

export function normalizeScreenshotQueue(items) {
  const byId = new Map();
  (Array.isArray(items) ? items : [])
    .map(normalizeScreenshotQueueItem)
    .filter(Boolean)
    .forEach(item => byId.set(item.id, item));
  return [...byId.values()];
}

function buildLegacyQueueId(item) {
  const payload = `${item.filePath || ''}|${item.createdAt || ''}`;
  return `legacy-${createHash('sha256').update(payload).digest('hex').slice(0, 32)}`;
}

function validQueueId(value) {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 200;
}

export function evaluateScreenshotQueueItem(item, now = Date.now()) {
  const normalized = normalizeScreenshotQueueItem(item);
  if (!normalized) return { action: 'discard', item: null, reason: 'invalid' };

  const retryAt = Date.parse(normalized.nextRetryAt || '');
  if (Number.isFinite(retryAt) && retryAt > Number(now)) {
    return { action: 'wait', item: normalized, reason: 'backoff' };
  }
  if (normalized.retryCount >= normalized.maxRetries) {
    return { action: 'discard', item: normalized, reason: 'max-retries' };
  }
  if (!normalized.filePath) {
    return { action: 'discard', item: normalized, reason: 'missing-file' };
  }
  if (String(normalized.metadata?.sessionId || '').startsWith('offline-')) {
    return { action: 'wait', item: normalized, reason: 'pending-session' };
  }
  return { action: 'upload', item: normalized, reason: null };
}

export function linkScreenshotSession(items, localSessionId, remoteSessionId) {
  if (!localSessionId || !remoteSessionId) return { items, replacements: 0 };
  let replacements = 0;
  const linkedItems = items.map(item => {
    if (String(item?.metadata?.sessionId || '') !== String(localSessionId)) return item;
    replacements += 1;
    return {
      ...item,
      metadata: { ...item.metadata, sessionId: remoteSessionId },
    };
  });
  return { items: linkedItems, replacements };
}

export function scheduleScreenshotRetry(item, error, now = Date.now()) {
  const normalized = normalizeScreenshotQueueItem(item) || {};
  const retryCount = nonNegativeInteger(normalized.retryCount) + 1;
  return {
    ...normalized,
    retryCount,
    nextRetryAt: new Date(Number(now) + getBackoffDelayMs(retryCount)).toISOString(),
    errorMessage: String(error?.message || error || normalized.errorMessage || 'Unknown error').slice(0, 1000),
  };
}

function nonNegativeInteger(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.floor(numeric)) : 0;
}

function positiveInteger(value, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0
    ? Math.min(maximum, Math.floor(numeric))
    : fallback;
}

function toIsoString(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
}
