export function getBackoffDelayMs(retryCount) {
  const attempt = Math.max(1, Number(retryCount) || 1);
  return Math.min(60 * 60 * 1000, 30_000 * 2 ** Math.min(attempt - 1, 7));
}

export function normalizeRetryAt(value, now = Date.now()) {
  if (!value) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || timestamp > Number(now) + 60 * 60 * 1000) return null;
  return new Date(timestamp).toISOString();
}

export function pruneOfflineQueue(items, {
  maxOfflineDays = 7,
  maxItems = 1000,
  getTimestamp = item => item.createdAt,
} = {}) {
  const retentionDays = Math.min(30, Math.max(1, Number(maxOfflineDays) || 7));
  const queueLimit = Math.min(10000, Math.max(1, Number(maxItems) || 1000));
  const oldestAllowed = Date.now() - retentionDays * 86400000;
  return (Array.isArray(items) ? items : [])
    .filter(item => {
      const timestamp = new Date(getTimestamp(item) || 0).getTime();
      return Number.isFinite(timestamp) && timestamp >= oldestAllowed;
    })
    .slice(-queueLimit);
}

export function linkOfflineSnapshots(items, localSessionId, remoteSessionId) {
  if (!localSessionId || !remoteSessionId) return { items, replacements: 0 };
  let replacements = 0;
  const linkedItems = (Array.isArray(items) ? items : []).map((item) => {
    if (String(item.localSessionId || "") !== String(localSessionId)) return item;
    replacements += 1;
    return { ...item, sessionId: remoteSessionId, localSessionId: null };
  });
  return { items: linkedItems, replacements };
}

export function scheduleOfflineRetry(item, now = Date.now()) {
  const retryCount = Math.max(0, Number(item?.retryCount) || 0) + 1;
  return {
    ...item,
    retryCount,
    nextRetryAt: new Date(now + getBackoffDelayMs(retryCount)).toISOString(),
  };
}

export function isOfflineItemReady(item, now = Date.now()) {
  if (!item?.sessionId) return false;
  if (!item.nextRetryAt) return true;
  const retryAt = new Date(item.nextRetryAt).getTime();
  return Number.isFinite(retryAt) && retryAt <= now;
}

export function reconcileQueueAfterProcessing({
  processingItems,
  currentItems,
  remainingItems,
  getId,
}) {
  const identify = typeof getId === 'function' ? getId : item => item?.id;
  const processing = Array.isArray(processingItems) ? processingItems : [];
  const current = Array.isArray(currentItems) ? currentItems : [];
  const remaining = Array.isArray(remainingItems) ? remainingItems : [];
  const processedIds = new Set(processing.map(identify).filter(Boolean));
  const originalById = new Map(processing.map(item => [identify(item), item]));
  const currentById = new Map(current.map(item => [identify(item), item]));
  const result = [];

  for (const pendingResult of remaining) {
    const id = identify(pendingResult);
    if (!id || !currentById.has(id)) continue;
    const currentItem = currentById.get(id);
    const originalItem = originalById.get(id);
    result.push(hasChanged(originalItem, currentItem) ? currentItem : pendingResult);
  }

  for (const item of current) {
    const id = identify(item);
    if (!id || !processedIds.has(id)) result.push(item);
  }

  return result;
}

function hasChanged(original, current) {
  if (original === undefined || current === undefined) return original !== current;
  if (original === current) return false;
  try {
    return JSON.stringify(original) !== JSON.stringify(current);
  } catch {
    return true;
  }
}
