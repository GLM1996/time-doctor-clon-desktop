import { normalizeActiveDomain } from './activeDomain.js';

export const BROWSER_EXTENSION_ORIGIN =
  'chrome-extension://pgpgcfgllapfcdggdjkmhiongaddjgdp';

export function normalizeBrowserDomainMessage(value, now = Date.now()) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const rawDomain = String(value.domain || '').trim().toLowerCase();
  if (!rawDomain || /[\s/?#:@]/.test(rawDomain)) return null;
  const domain = normalizeActiveDomain(`https://${rawDomain}`);
  if (!domain) return null;

  const observedAt = new Date(value.observedAt);
  const timestamp = observedAt.getTime();
  if (!Number.isFinite(timestamp) || Math.abs(now - timestamp) > 2 * 60 * 1000) {
    return null;
  }

  return { domain, observedAt: timestamp };
}

export function isAllowedBrowserExtensionOrigin(origin) {
  return origin === BROWSER_EXTENSION_ORIGIN;
}
