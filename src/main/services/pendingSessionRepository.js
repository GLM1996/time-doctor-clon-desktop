import fs from 'node:fs';
import { normalizeRetryAt } from './offlineQueuePolicy.js';

export default class PendingSessionRepository {
  constructor({ filePath, storage, exists = fs.existsSync }) {
    if (!filePath) throw new Error('Se requiere la ruta de sesiones pendientes');
    if (!storage?.readJson || !storage?.writeJson) {
      throw new Error('Se requiere un almacenamiento JSON válido');
    }
    this.filePath = filePath;
    this.storage = storage;
    this.exists = exists;
  }

  load() {
    if (!this.exists(this.filePath)) return [];
    return normalizePendingSessions(this.storage.readJson(this.filePath, []));
  }

  save(items) {
    const normalized = normalizePendingSessions(items);
    this.storage.writeJson(this.filePath, normalized);
    return normalized;
  }
}

export function normalizePendingSessions(value) {
  if (!Array.isArray(value)) return [];
  const normalized = value
    .filter(item => item && typeof item === 'object' && !Array.isArray(item))
    .map(normalizePendingSession)
    .filter(Boolean);

  const byKey = new Map();
  normalized.forEach(item => {
    const identifier = item.type === 'stop-existing' ? item.sessionId : item.localId;
    byKey.set(`${item.type}:${identifier}`, item);
  });
  return [...byKey.values()];
}

function normalizePendingSession(item) {
  let type = item.type;
  let localId = item.localId;

  if (!type && item.sessionId && item.startTime && item.endTime) {
    type = 'offline-session';
    localId = item.sessionId;
  }

  if (type === 'stop-existing' && !validIdentifier(item.sessionId)) return null;
  if (type === 'offline-session' && !validIdentifier(localId)) return null;
  if (!['stop-existing', 'offline-session'].includes(type)) return null;

  return {
    ...item,
    type,
    ...(type === 'offline-session' ? { localId: String(localId).trim() } : {}),
    ...(type === 'stop-existing' ? { sessionId: String(item.sessionId).trim() } : {}),
    retryCount: Math.min(1000, Math.max(0, Math.floor(Number(item.retryCount) || 0))),
    nextRetryAt: normalizeRetryAt(item.nextRetryAt),
  };
}

function validIdentifier(value) {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 200;
}
