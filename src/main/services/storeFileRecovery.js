import fs from 'node:fs';

const MAX_STORE_BYTES = 5 * 1024 * 1024;

export function quarantineInvalidJsonStore(filePath, now = Date.now()) {
  if (!fs.existsSync(filePath)) return null;
  try {
    const stats = fs.statSync(filePath);
    if (!stats.isFile() || stats.size <= 0 || stats.size > MAX_STORE_BYTES) throw new Error('invalid size');
    const value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid root');
    return null;
  } catch {
    const quarantinePath = `${filePath}.corrupt-${now}`;
    fs.renameSync(filePath, quarantinePath);
    return quarantinePath;
  }
}
