export function persistAuthSession(storage, { accessToken, refreshToken, sessionId } = {}) {
  if (!storage || !accessToken) return false;

  const hasRefreshSession = Boolean(refreshToken || sessionId);
  const hasCompleteRefreshSession = Boolean(refreshToken && sessionId);
  const accessStored = storage.setToken(accessToken) === true;
  let refreshStored = true;
  let sessionStored = true;

  if (hasCompleteRefreshSession) {
    refreshStored = storage.setRefreshToken(refreshToken) === true;
    sessionStored = storage.setSessionId(sessionId) === true;
  } else {
    storage.clearRefreshToken();
    storage.clearSessionId();
  }

  const persisted = accessStored && (!hasRefreshSession || (
    hasCompleteRefreshSession && refreshStored && sessionStored
  ));

  if (!persisted) storage.clearAll();
  return persisted;
}
