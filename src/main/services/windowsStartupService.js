import { app } from 'electron';

import logger from '../utils/logger.js';

const AUTO_START_ARGUMENT = '--autostart';

function isSupported() {
  return process.platform === 'win32' && app.isPackaged;
}

const windowsStartupService = {
  setEnabled(enabled) {
    if (!isSupported()) {
      logger.info('Inicio con Windows omitido fuera de una instalacion empaquetada.');
      return { enabled: enabled === true, supported: false };
    }

    try {
      app.setLoginItemSettings({
        openAtLogin: enabled === true,
        path: process.execPath,
        args: [AUTO_START_ARGUMENT],
      });

      const settings = app.getLoginItemSettings({
        path: process.execPath,
        args: [AUTO_START_ARGUMENT],
      });

      if (settings.openAtLogin !== (enabled === true)) {
        logger.warn('Windows no confirmo el cambio de inicio automatico.');
      }

      logger.info(`Inicio automatico con Windows ${settings.openAtLogin ? 'habilitado' : 'deshabilitado'}.`);
      return { enabled: settings.openAtLogin, supported: true };
    } catch (error) {
      logger.error(`No se pudo cambiar el inicio con Windows: ${error.message}`);
      return { enabled: enabled === true, supported: true, error: true };
    }
  },

  enable() {
    return this.setEnabled(true);
  },
};

export default windowsStartupService;
