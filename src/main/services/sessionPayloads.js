import os from 'node:os';
import { randomUUID } from 'node:crypto';

const STOP_REASONS = new Set(['manual', 'system', 'inactivity']);

export function buildDeviceInfo(overrides = {}, runtime = {}) {
  return {
    os: runtime.platform || process.platform,
    osVersion: runtime.osVersion || 'unknown',
    hostname: runtime.hostname || os.hostname(),
    appVersion: runtime.appVersion || '1.0.0',
    ...sanitizeObject(overrides),
  };
}

export function buildWorkSelection(value = {}) {
  return {
    projectId: value?.projectId || null,
    taskId: value?.taskId || null,
  };
}

export function createOfflineSession(now = new Date(), uuid = randomUUID()) {
  return {
    _id: `offline-${uuid}`,
    startTime: toIsoString(now),
    status: 'running',
    isOffline: true,
  };
}

export function normalizeStopInput(reason, notes) {
  return {
    reason: STOP_REASONS.has(reason) ? reason : 'system',
    notes: typeof notes === 'string' && notes.trim() ? notes.trim() : null,
  };
}

export function buildPendingOfflineSession({
  sessionId,
  startTime,
  endTime,
  duration,
  reason,
  notes,
  deviceInfo,
  workSelection,
}) {
  return {
    localId: sessionId,
    startTime: toIsoString(startTime),
    endTime: toIsoString(endTime),
    duration: normalizeDuration(duration),
    reason,
    notes: notes || null,
    deviceInfo: deviceInfo || null,
    ...buildWorkSelection(workSelection),
    createdAt: toIsoString(endTime),
  };
}

export function buildPendingExistingStop({ sessionId, endTime, duration, reason, notes }) {
  return {
    sessionId,
    endTime: toIsoString(endTime),
    duration: normalizeDuration(duration),
    reason,
    notes: notes || null,
    createdAt: toIsoString(endTime),
  };
}

function sanitizeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeDuration(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.floor(numeric)) : 0;
}

function toIsoString(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
}
