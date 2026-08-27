import { normalizeActiveDomain } from './activeDomain.js';

export function normalizeNativeBrowserDomainMessage(value, now = Date.now()) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const rawDomain = String(value.domain || '').trim().toLowerCase();
  if (!rawDomain || /[\s/?#:@]/.test(rawDomain)) return null;
  const domain = normalizeActiveDomain(`https://${rawDomain}`);
  if (!domain) return null;

  const observedAt = new Date(value.observedAt).getTime();
  if (!Number.isFinite(observedAt) || Math.abs(now - observedAt) > 2 * 60 * 1000) {
    return null;
  }

  return { domain, observedAt };
}
