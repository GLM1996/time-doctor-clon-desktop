const BEARER_PATTERN = /\bbearer\s+[^\s,;]+/gi;
const CREDENTIAL_PATTERN = /\b(access[_-]?token|refresh[_-]?token|password|authorization|cookie|secret)\b\s*[:=]\s*["']?[^\s,;"'}]+/gi;
const STRIPE_SECRET_PATTERN = /\b(?:whsec|sk_live|sk_test)_[a-z0-9_]+/gi;
const USER_PATH_PATTERN = /(?:[a-z]:\\Users\\|\/Users\/|\/home\/)[^\\/\s]+/gi;
const URL_PATTERN = /https?:\/\/[^\s)]+/gi;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const JWT_PATTERN = /\beyJ[a-z0-9_-]+\.[a-z0-9_-]+\.[a-z0-9_-]+\b/gi;
const MONGO_ID_PATTERN = /\b[a-f0-9]{24}\b/gi;
const UUID_PATTERN = /\b[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\b/gi;

export function sanitizeCrashText(value, maxLength = 8000) {
  return String(value || '')
    .replace(BEARER_PATTERN, 'Bearer [REDACTED]')
    .replace(CREDENTIAL_PATTERN, (_match, key) => `${key}=[REDACTED]`)
    .replace(STRIPE_SECRET_PATTERN, '[REDACTED]')
    .replace(USER_PATH_PATTERN, '[USER_PATH]')
    .replace(URL_PATTERN, '[URL]')
    .replace(EMAIL_PATTERN, '[EMAIL]')
    .replace(JWT_PATTERN, '[TOKEN]')
    .replace(MONGO_ID_PATTERN, '[ID]')
    .replace(UUID_PATTERN, '[ID]')
    .slice(0, maxLength);
}
