import fs from "node:fs";
import path from "node:path";
import { cleanupAtomicTempFiles } from "./localDataRecovery.js";

const MAX_CONFIG_BYTES = 1024 * 1024;

export function writeConfigFile(filePath, config) {
  if (!isPlainObject(config))
    throw new Error("La configuración local no es válida.");
  const tempPath = `${filePath}.${process.pid}.tmp`;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  cleanupAtomicTempFiles(filePath);
  try {
    fs.writeFileSync(tempPath, JSON.stringify(config, null, 2), {
      encoding: "utf8",
      mode: 0o600,
    });
    fs.renameSync(tempPath, filePath);
  } finally {
    if (fs.existsSync(tempPath)) fs.rmSync(tempPath, { force: true });
  }
}

export function readConfigFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const stats = fs.statSync(filePath);
  if (!stats.isFile() || stats.size <= 0 || stats.size > MAX_CONFIG_BYTES) {
    throw new Error(
      "El archivo de configuración local tiene un tamaño inválido.",
    );
  }
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (!isPlainObject(parsed))
    throw new Error("La configuración local no contiene un objeto válido.");
  return parsed;
}

export function quarantineConfigFile(filePath, now = Date.now()) {
  if (!fs.existsSync(filePath)) return null;
  const quarantinePath = `${filePath}.corrupt-${now}`;
  fs.renameSync(filePath, quarantinePath);
  return quarantinePath;
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
