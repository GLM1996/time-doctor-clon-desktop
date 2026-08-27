import path from 'node:path';

export function isPathInsideDirectory(filePath, directoryPath) {
  if (typeof filePath !== 'string' || typeof directoryPath !== 'string') return false;
  const relative = path.relative(path.resolve(directoryPath), path.resolve(filePath));
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
}

export function isManagedPendingScreenshotName(fileName) {
  return typeof fileName === 'string' &&
    /^pending-\d+-m\d+-[a-z0-9]+\.jpg$/i.test(fileName);
}
