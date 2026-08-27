export function verifyInstallerMetadata({ metadata, version, installerName, actualSize, actualSha512 }) {
  const text = String(metadata || '');
  const metadataVersion = capture(text, /^version:\s*([^\s]+)\s*$/m);
  const metadataPath = capture(text, /^path:\s*(.+?)\s*$/m);
  const fileUrl = capture(text, /^\s{2}- url:\s*(.+?)\s*$/m);
  const fileSha512 = capture(text, /^\s{4}sha512:\s*([^\s]+)\s*$/m);
  const fileSize = Number(capture(text, /^\s{4}size:\s*(\d+)\s*$/m));
  const errors = [];
  if (metadataVersion !== version) errors.push('version');
  if (metadataPath !== installerName || fileUrl !== installerName) errors.push('installer');
  if (!Number.isSafeInteger(fileSize) || fileSize !== actualSize) errors.push('size');
  if (!fileSha512 || fileSha512 !== actualSha512) errors.push('sha512');
  return { valid: errors.length === 0, errors };
}

function capture(value, pattern) {
  return value.match(pattern)?.[1]?.trim() || '';
}
