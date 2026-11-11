export function describeSessionSyncError(error) {
  const data = error?.response?.data;
  const details = Array.isArray(data?.errors) ? data.errors.filter(value => typeof value === 'string') : [];
  const message = data?.message || error?.message || 'No se pudo sincronizar todavía';
  return (details.length ? message + ': ' + details.join('; ') : message).slice(0, 1200);
}
