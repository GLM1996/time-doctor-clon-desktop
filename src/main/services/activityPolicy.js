import { isNetworkError } from './timerServiceUtils.js';

export function calculateActivityPercentage(window, expectedSize = window?.length || 0) {
  const size = Math.max(0, Math.floor(Number(expectedSize) || 0));
  if (size === 0) return 0;
  const samples = Array.isArray(window) ? window.slice(-size) : [];
  const activeSeconds = samples.filter(Boolean).length;
  return Math.min(100, Math.max(0, Math.round((activeSeconds / size) * 100)));
}

export function getActivityStatus({
  activityPercentage,
  hasRecentInput,
  systemIdleTime,
  idleThresholdSeconds,
  lowActivityThreshold,
}) {
  if (normalizeCount(systemIdleTime) >= normalizeCount(idleThresholdSeconds)) return 'idle';
  if (normalizePercentage(activityPercentage) < normalizePercentage(lowActivityThreshold)) {
    return 'low_activity';
  }
  return hasRecentInput ? 'active' : 'inactive';
}

export function isRetryableActivityError(error) {
  if (isNetworkError(error)) return true;
  const status = Number(error?.response?.status);
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

export function isClosedSessionActivityError(error) {
  if (Number(error?.response?.status) === 409) return true;
  const message = String(error?.response?.data?.message || error?.message || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  return [
    'sesion ya esta cerrada',
    'sesion ya esta finalizada',
    'session is closed',
    'session has ended',
  ].some(fragment => message.includes(fragment));
}

function normalizeCount(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.floor(numeric)) : 0;
}

function normalizePercentage(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.min(100, Math.max(0, numeric)) : 0;
}
