import { app } from 'electron';
import Store from 'electron-store';
import path from 'node:path';
import logger from '../utils/logger.js';
import { quarantineInvalidJsonStore } from './storeFileRecovery.js';

export function createResilientElectronStore(options = {}) {
  const directory = options.cwd || app.getPath('userData');
  const filePath = path.join(directory, `${options.name || 'config'}.json`);
  const quarantined = quarantineInvalidJsonStore(filePath);
  if (quarantined) logger.warn(`Almacén local dañado apartado en: ${path.basename(quarantined)}`);

  try {
    return new Store(options);
  } catch (error) {
    const retryQuarantine = quarantineInvalidJsonStore(filePath);
    if (!retryQuarantine) throw error;
    logger.warn(`Almacén local recuperado tras un error de lectura: ${path.basename(retryQuarantine)}`);
    return new Store(options);
  }
}
