import { evaluateLogoutSyncState } from './logoutSyncPolicy.js';

// Signing out is a local action. Network, monitoring and persistence failures cannot veto it.
export function logoutSession({ timer, store, api, tray, onError = () => {} }) {
  const attempt = (fn, fallback = null) => {
    try { return fn(); } catch (error) { try { onError(error); } catch { /* A diagnostic failure must not veto logout. */ } return fallback; }
  };
  const user = attempt(() => store.getUser());
  attempt(() => timer.prepareForShutdown());
  const sync = evaluateLogoutSyncState(attempt(() => timer.getSyncStatus(), { pendingTotal: 1 }));
  const refreshToken = attempt(() => store.getRefreshToken());
  const sessionId = attempt(() => store.getSessionId());
  const token = attempt(() => store.getToken());
  if (refreshToken && sessionId) {
    void Promise.resolve().then(() => api.post('/auth/logout', { refreshToken, sessionId }, {
      _skipAuthRefresh: true, timeout: 5000, headers: { Authorization: 'Bearer ' + token },
    })).catch(error => { try { onError(error); } catch { /* A diagnostic failure must not veto logout. */ } });
  }
  attempt(() => store.clearAll());
  // Also clear each token if an interrupted bulk write left any of them behind.
  for (const method of ['clearToken', 'clearRefreshToken', 'clearSessionId']) attempt(() => store[method]?.());
  if (sync.pendingTotal > 0 && user) attempt(() => store.setUser(user));
  attempt(() => api.clearToken());
  attempt(() => tray.refreshIdentity());
  return { success: true, pendingTotal: sync.pendingTotal, message: sync.message };
}
