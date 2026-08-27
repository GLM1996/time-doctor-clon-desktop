export function getUserIdentity(user) {
  const id = user?._id || user?.id;
  if (id) return `id:${String(id)}`;
  const email = typeof user?.email === 'string' ? user.email.trim().toLowerCase() : '';
  return email ? `email:${email}` : null;
}

export function canUsePendingData({ previousUser, nextUser, pendingTotal } = {}) {
  const count = Math.max(0, Math.floor(Number(pendingTotal) || 0));
  if (count === 0 || !previousUser) return true;
  const previousIdentity = getUserIdentity(previousUser);
  const nextIdentity = getUserIdentity(nextUser);
  return Boolean(previousIdentity && nextIdentity && previousIdentity === nextIdentity);
}
