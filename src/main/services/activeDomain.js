export function normalizeActiveDomain(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    const hostname = url.hostname.toLowerCase().replace(/^www\./, '');
    return hostname && hostname.length <= 253 ? hostname : null;
  } catch {
    return null;
  }
}

export function normalizeExcludedDomains(values) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map((value) => {
    const text = String(value || '').trim().toLowerCase().replace(/^www\./, '');
    return /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(text) ? text : null;
  }).filter(Boolean))].slice(0, 100);
}

export function isDomainExcluded(domain, excludedDomains = []) {
  const normalized = String(domain || '').toLowerCase();
  return normalizeExcludedDomains(excludedDomains).some((blocked) => normalized === blocked || normalized.endsWith(`.${blocked}`));
}
