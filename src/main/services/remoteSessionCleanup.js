export async function revokeRemoteSession({
  post,
  accessToken,
  refreshToken,
  sessionId,
  onError,
} = {}) {
  if (typeof post !== 'function' || !accessToken || !refreshToken || !sessionId) return false;

  try {
    await post('/auth/logout', { refreshToken, sessionId }, {
      _skipAuthRefresh: true,
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    return true;
  } catch (error) {
    if (typeof onError === 'function') onError(error);
    return false;
  }
}
