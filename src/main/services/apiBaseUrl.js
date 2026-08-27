const DEFAULT_API_URL = 'https://backend.logyourtime.com/api';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

export function resolveApiBaseUrl(value, { isPackaged = false } = {}) {
  try {
    const url = new URL(typeof value === 'string' && value.trim() ? value.trim() : DEFAULT_API_URL);
    const localDevelopmentUrl = !isPackaged && url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname);
    if (url.protocol !== 'https:' && !localDevelopmentUrl) return DEFAULT_API_URL;
    if (url.username || url.password) return DEFAULT_API_URL;
    url.hash = '';
    url.search = '';
    url.pathname = url.pathname.replace(/\/+$/, '') || '/api';
    return url.toString().replace(/\/$/, '');
  } catch {
    return DEFAULT_API_URL;
  }
}

export { DEFAULT_API_URL };
