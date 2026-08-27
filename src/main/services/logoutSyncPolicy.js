export function evaluateLogoutSyncState(syncStatus = {}) {
  const pendingTotal = Math.max(0, Math.floor(Number(syncStatus?.pendingTotal) || 0));
  return {
    canLogout: pendingTotal === 0,
    pendingTotal,
    message: pendingTotal === 0
      ? null
      : `Hay ${pendingTotal} ${pendingTotal === 1 ? 'operación pendiente' : 'operaciones pendientes'} de sincronizar. Conéctate a internet y espera a que finalice la sincronización antes de cerrar sesión.`,
  };
}
