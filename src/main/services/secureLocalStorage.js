import { app, safeStorage } from 'electron';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  decryptOfflineBuffer,
  encryptOfflineBuffer,
  isEncryptedBuffer,
} from './offlineCrypto.js';
import { cleanupAtomicTempFiles } from './localDataRecovery.js';

const KEY_PREFIX = 'safe:';

class SecureLocalStorage {
  constructor() {
    this.key = null;
  }

  _keyPath() {
    return path.join(app.getPath('userData'), 'offline-storage.key');
  }

  _getKey() {
    if (this.key) return this.key;
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('El cifrado seguro del sistema operativo no esta disponible');
    }

    const keyPath = this._keyPath();
    if (fs.existsSync(keyPath)) {
      const stored = fs.readFileSync(keyPath, 'utf8').trim();
      if (!stored.startsWith(KEY_PREFIX)) {
        throw new Error('Formato de clave offline invalido');
      }
      const protectedKey = Buffer.from(stored.slice(KEY_PREFIX.length), 'base64');
      this.key = Buffer.from(safeStorage.decryptString(protectedKey), 'base64');
      if (this.key.length !== 32) throw new Error('Clave offline invalida');
      return this.key;
    }

    this.key = crypto.randomBytes(32);
    const protectedKey = safeStorage.encryptString(this.key.toString('base64'));
    this._atomicWrite(keyPath, Buffer.from(`${KEY_PREFIX}${protectedKey.toString('base64')}`));
    return this.key;
  }

  _atomicWrite(filePath, data) {
    const tempPath = `${filePath}.${process.pid}.tmp`;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    cleanupAtomicTempFiles(filePath);
    try {
      fs.writeFileSync(tempPath, data, { mode: 0o600 });
      fs.renameSync(tempPath, filePath);
    } finally {
      if (fs.existsSync(tempPath)) fs.rmSync(tempPath, { force: true });
    }
  }

  writeBuffer(filePath, value) {
    this._atomicWrite(filePath, encryptOfflineBuffer(value, this._getKey()));
  }

  readBuffer(filePath) {
    return decryptOfflineBuffer(fs.readFileSync(filePath), this._getKey());
  }

  writeJson(filePath, value) {
    this.writeBuffer(filePath, Buffer.from(JSON.stringify(value), 'utf8'));
  }

  readJson(filePath, fallback = []) {
    if (!fs.existsSync(filePath)) return fallback;
    const stored = fs.readFileSync(filePath);
    if (isEncryptedBuffer(stored)) {
      return JSON.parse(decryptOfflineBuffer(stored, this._getKey()).toString('utf8'));
    }

    const legacyValue = JSON.parse(stored.toString('utf8'));
    try {
      this.writeJson(filePath, legacyValue);
    } catch {
      // Se conserva el archivo heredado si safeStorage aun no esta disponible.
    }
    return legacyValue;
  }

  migrateFile(filePath) {
    if (!filePath || !fs.existsSync(filePath)) return false;
    const stored = fs.readFileSync(filePath);
    if (isEncryptedBuffer(stored)) return false;
    this.writeBuffer(filePath, stored);
    return true;
  }
}

export default new SecureLocalStorage();
