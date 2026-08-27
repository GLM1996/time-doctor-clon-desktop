const MAX_EMAIL_LENGTH = 254;
const MAX_PASSWORD_LENGTH = 1024;
const MAX_ID_LENGTH = 128;
const MAX_NOTES_LENGTH = 2000;

export function normalizeLoginPayload(payload) {
  const source = isPlainObject(payload) ? payload : {};
  const email = normalizeEmail(source.email);
  const password = typeof source.password === 'string' ? source.password : '';

  return {
    email,
    password: password.length <= MAX_PASSWORD_LENGTH ? password : '',
    rememberCredentials: source.rememberCredentials === true,
  };
}

export function normalizeTimerStartPayload(payload) {
  const source = isPlainObject(payload) ? payload : {};

  return {
    deviceInfo: normalizeDeviceInfo(source.deviceInfo),
    projectId: normalizeId(source.projectId),
    taskId: normalizeId(source.taskId),
  };
}

export function normalizeTimerStopPayload(payload) {
  const source = isPlainObject(payload) ? payload : {};
  return {
    reason: normalizeText(source.reason, 32) || 'manual',
    notes: normalizeText(source.notes, MAX_NOTES_LENGTH),
  };
}

export function normalizeBreakPayload(payload) {
  const source = isPlainObject(payload) ? payload : {};
  return {
    typeId: normalizeId(source.typeId),
    notes: normalizeText(source.notes, MAX_NOTES_LENGTH),
  };
}

export function normalizeScreenshotStartPayload(payload) {
  const source = isPlainObject(payload) ? payload : {};
  const numeric = Number(source.intervalMinutes);
  return {
    intervalMinutes: Number.isFinite(numeric)
      ? Math.min(60, Math.max(1, Math.floor(numeric)))
      : 5,
  };
}

function normalizeEmail(value) {
  if (typeof value !== 'string') return '';
  const email = value.trim().toLowerCase();
  if (email.length > MAX_EMAIL_LENGTH) return '';
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}

function normalizeId(value) {
  return normalizeText(value, MAX_ID_LENGTH) || null;
}

function normalizeText(value, maxLength) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLength);
}

function normalizeDeviceInfo(value) {
  if (!isPlainObject(value)) return {};

  return Object.fromEntries(
    Object.entries(value)
      .slice(0, 12)
      .filter(([, item]) => ['string', 'number', 'boolean'].includes(typeof item))
      .map(([key, item]) => [
        normalizeText(key, 64),
        typeof item === 'string' ? item.slice(0, 256) : item,
      ])
      .filter(([key]) => key),
  );
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
