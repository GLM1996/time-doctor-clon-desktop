const MAX_STORED_USER_BYTES = 64 * 1024;

export function serializeStoredUser(user) {
  if (!isPlainObject(user)) return '';
  try {
    const serialized = JSON.stringify(user);
    return Buffer.byteLength(serialized, 'utf8') <= MAX_STORED_USER_BYTES ? serialized : '';
  } catch {
    return '';
  }
}

export function parseStoredUser(value) {
  if (typeof value !== 'string' || !value) return null;
  try {
    const parsed = JSON.parse(value);
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
