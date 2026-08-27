const TERMINAL_REFRESH_STATUSES = new Set([400, 401, 403]);

export function shouldRevokeSessionAfterRefreshError(error) {
  return TERMINAL_REFRESH_STATUSES.has(Number(error?.response?.status));
}

export function isAuthenticationRequiredError(error) {
  return Number(error?.response?.status) === 401;
}

export function getRefreshFailureMessage(error) {
  if (shouldRevokeSessionAfterRefreshError(error)) return 'La sesión fue revocada o expiró definitivamente.';
  if (!error?.response) return 'No se pudo renovar la sesión por un problema de conexión.';
  return 'El servidor no pudo renovar la sesión temporalmente.';
}
