export function isNetworkError(error) {
  return (
    !error?.response ||
    error?.code === 'ERR_NETWORK' ||
    error?.code === 'ECONNABORTED' ||
    error?.code === 'ETIMEDOUT' ||
    error?.code === 'ENOTFOUND' ||
    error?.code === 'ECONNREFUSED'
  );
}

export function isAlreadyClosedSessionError(error) {
  const status = Number(error?.response?.status);
  if (status === 404 || status === 409) return true;

  const message = normalizeMessage(error?.response?.data?.message || error?.message);
  return (
    message.includes('sesion ya esta finalizada') ||
    message.includes('sesion ya esta cerrada') ||
    message.includes('session has ended')
  );
}

export function formatDuration(seconds) {
  const numericSeconds = Number(seconds);
  const safeSeconds = Number.isFinite(numericSeconds)
    ? Math.max(0, Math.floor(numericSeconds))
    : 0;
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const remainingSeconds = safeSeconds % 60;

  return [hours, minutes, remainingSeconds]
    .map(value => String(value).padStart(2, '0'))
    .join(':');
}

function normalizeMessage(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}
