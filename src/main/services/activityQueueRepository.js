import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { normalizeRetryAt, pruneOfflineQueue } from './offlineQueuePolicy.js';

export default class ActivityQueueRepository {
  constructor({ filePath, storage, exists = fs.existsSync }) {
    if (!filePath) throw new Error('Se requiere la ruta de la cola de actividad');
    if (!storage?.readJson || !storage?.writeJson) {
      throw new Error('Se requiere un almacenamiento JSON válido');
    }
    this.filePath = filePath;
    this.storage = storage;
    this.exists = exists;
  }

  load(policy) {
    if (!this.exists(this.filePath)) return [];
    return normalizeAndPrune(this.storage.readJson(this.filePath, []), policy);
  }

  save(items, policy) {
    const normalized = normalizeAndPrune(items, policy);
    this.storage.writeJson(this.filePath, normalized);
    return normalized;
  }
}

export function normalizeAndPrune(value, policy = {}) {
  const normalized = Array.isArray(value)
    ? value
        .filter(item => item && typeof item === 'object' && !Array.isArray(item))
        .map(normalizeActivityItem)
        .filter(Boolean)
    : [];

  const byEventId = new Map();
  normalized.forEach(item => byEventId.set(item.clientEventId, item));
  const items = [...byEventId.values()];

  return pruneOfflineQueue(items, {
    maxOfflineDays: Math.min(30, Math.max(1, Number(policy.maxOfflineDays) || 7)),
    maxItems: Math.min(10000, Math.max(1, Number(policy.maxActivitySnapshots) || 10000)),
    getTimestamp: item => item.createdAt || item.timestamp,
  });
}

function normalizeActivityItem(item) {
  if (!validIdentifier(item.sessionId) && !validIdentifier(item.localSessionId)) {
    return null;
  }
  const clientEventId = validIdentifier(item.clientEventId, 100)
    ? item.clientEventId.trim()
    : buildLegacyEventId(item);
  return {
    ...item,
    clientEventId,
    retryCount: Math.min(1000, Math.max(0, Math.floor(Number(item.retryCount) || 0))),
    nextRetryAt: normalizeRetryAt(item.nextRetryAt),
  };
}

function buildLegacyEventId(item) {
  const stablePayload = JSON.stringify({
    sessionId: item.sessionId || null,
    localSessionId: item.localSessionId || null,
    timestamp: item.timestamp || item.createdAt || null,
    activityPercentage: item.activityPercentage ?? null,
    activeTime: item.activeTime ?? null,
    idleTime: item.idleTime ?? null,
  });
  return `legacy-${createHash('sha256').update(stablePayload).digest('hex').slice(0, 32)}`;
}

function validIdentifier(value, maxLength = 200) {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= maxLength;
}
