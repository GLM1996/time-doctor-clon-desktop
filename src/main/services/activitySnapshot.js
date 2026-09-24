import { randomUUID } from 'node:crypto';

export function createActivitySnapshot({
  sessionId,
  isOffline,
  activityPercentage,
  activeTime,
  idleTime,
  status,
  systemIdleTime,
  activeWindow,
  activeApp,
  activeDomain,
  trackActiveWindow,
  now = new Date(),
  clientEventId = randomUUID(),
}) {
  const localSession = Boolean(isOffline) || String(sessionId).startsWith('offline-');
  const timestamp = toIsoString(now);
  const normalizedActiveTime = nonNegativeInteger(activeTime);
  const normalizedIdleTime = nonNegativeInteger(idleTime);

  return {
    clientEventId,
    sessionId: localSession ? null : sessionId,
    localSessionId: localSession ? sessionId : null,
    timestamp,
    activityPercentage: percentage(activityPercentage),
    totalDuration: normalizedActiveTime + normalizedIdleTime,
    activeTime: normalizedActiveTime,
    idleTime: normalizedIdleTime,
    keyboardEvents: 0,
    mouseEvents: 0,
    totalEvents: 0,
    status: status || 'active',
    idleTimeSystem: nonNegativeInteger(systemIdleTime),
    activeWindow: trackActiveWindow ? normalizeText(activeWindow) : null,
    activeApp: trackActiveWindow ? normalizeText(activeApp) : null,
    activeDomain: trackActiveWindow ? normalizeDomain(activeDomain) : null,
    createdAt: timestamp,
  };
}

export function toActivityApiPayload(
  snapshot,
  { defaultIntervalSeconds = 60, clientEventId = randomUUID() } = {},
) {
  const intervalSeconds = integerBetween(
    snapshot?.intervalSeconds,
    1,
    120,
    integerBetween(defaultIntervalSeconds, 1, 120, 60),
  );
  const activityPercentage = percentage(snapshot?.activityPercentage);

  return {
    sessionId: snapshot?.sessionId || null,
    clientEventId: snapshot?.clientEventId || clientEventId,
    timestamp: snapshot?.timestamp || new Date().toISOString(),
    activityPercentage,
    keyboardEvents: nonNegativeInteger(snapshot?.keyboardEvents),
    mouseEvents: nonNegativeInteger(snapshot?.mouseEvents),
    // This API field represents only this interval, never the cumulative counter.
    idleTime: Math.round(intervalSeconds * ((100 - activityPercentage) / 100)),
    intervalSeconds,
    status: snapshot?.status || 'active',
    activeWindow: normalizeText(snapshot?.activeWindow),
    activeApp: normalizeText(snapshot?.activeApp),
    activeDomain: normalizeDomain(snapshot?.activeDomain),
  };
}

function normalizeText(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, 200) : null;
}

function normalizeDomain(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(normalized)
    ? normalized
    : null;
}

function percentage(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.min(100, Math.max(0, numeric)) : 0;
}

function nonNegativeInteger(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.floor(numeric)) : 0;
}

function integerBetween(value, minimum, maximum, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric)
    ? Math.min(maximum, Math.max(minimum, Math.floor(numeric)))
    : fallback;
}

function toIsoString(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
}
