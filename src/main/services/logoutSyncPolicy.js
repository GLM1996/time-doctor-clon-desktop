export function evaluateLogoutSyncState(syncStatus = {}) {
  const pendingTotal = Math.max(0, Math.floor(Number(syncStatus.pendingTotal) || 0));
  return {
    canLogout: true,
    pendingTotal,
    message: pendingTotal > 0 ? 'Los registros pendientes quedan guardados en este equipo y se sincronizarán al volver a iniciar sesión.' : null,
  };
}
