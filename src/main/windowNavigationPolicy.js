import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ALLOWED_EXTERNAL_HOSTS = new Set([
  'logyourtime.com',
  'www.logyourtime.com',
]);
const SUPPORT_EMAIL = 'support@logyourtime.com';

export function isAllowedExternalUrl(value) {
  try {
    const url = new URL(value);

    if (url.protocol === 'mailto:') {
      return !url.search && !url.hash && decodeURIComponent(url.pathname).toLowerCase() === SUPPORT_EMAIL;
    }
    if (url.protocol !== 'https:') return false;

    return ALLOWED_EXTERNAL_HOSTS.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

export function isAllowedRendererNavigation(value, {
  isDev = false,
  rendererDevUrl,
  rendererFile,
} = {}) {
  try {
    const target = new URL(value);

    if (isDev && rendererDevUrl) {
      const developmentOrigin = new URL(rendererDevUrl).origin;
      if (target.origin === developmentOrigin) return true;
    }

    if (target.protocol !== 'file:' || !rendererFile) return false;

    return normalizePath(fileURLToPath(target)) === normalizePath(rendererFile);
  } catch {
    return false;
  }
}

function normalizePath(value) {
  const normalized = path.resolve(value);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}
