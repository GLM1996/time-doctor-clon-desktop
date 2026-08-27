import fs from 'node:fs';
import path from 'node:path';

export function quarantineLocalPath(targetPath, now = Date.now()) {
  if (!targetPath || !fs.existsSync(targetPath)) return null;
  const quarantinePath = `${targetPath}.recovery-${now}`;
  fs.renameSync(targetPath, quarantinePath);
  return quarantinePath;
}

export function cleanupAtomicTempFiles(targetPath) {
  if (!targetPath) return 0;
  const directory = path.dirname(targetPath);
  if (!fs.existsSync(directory)) return 0;
  const baseName = path.basename(targetPath).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^${baseName}\\.\\d+\\.tmp$`);
  let deleted = 0;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isFile() || !pattern.test(entry.name)) continue;
    fs.rmSync(path.join(directory, entry.name), { force: true });
    deleted += 1;
  }
  return deleted;
}
