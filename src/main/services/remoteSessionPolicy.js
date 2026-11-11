export function getRemoteSessionState(session) {
  if (!session || typeof session !== 'object') return 'unknown';
  if (!['ended', 'stopped'].includes(session.status)) {
    return ['active', 'idle', 'paused'].includes(session.status) ? 'open' : 'unknown';
  }
  return session.autoClosed === true && session.closedReason === 'timeout'
    ? 'recoverable'
    : 'closed';
}

export async function confirmRemoteClosure({ sessionId, session, getSession }) {
  const remote = session ?? await getSession(sessionId);
  if (remote?._id && String(remote._id) !== String(sessionId)) return { state: 'unknown', session: null };
  return { state: getRemoteSessionState(remote), session: remote };
}
