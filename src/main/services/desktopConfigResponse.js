export function extractDesktopSettings(responseData) {
  if (responseData?.success !== true) {
    throw new Error(responseData?.message || 'El servidor rechazó la configuración.');
  }

  const settings = responseData?.data?.settings;
  if (!isPlainObject(settings)) {
    throw new Error('El servidor devolvió una configuración incompleta.');
  }

  return settings;
}

export function normalizeSyncIntervalMinutes(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric)
    ? Math.min(1440, Math.max(1, Math.floor(numeric)))
    : 5;
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
