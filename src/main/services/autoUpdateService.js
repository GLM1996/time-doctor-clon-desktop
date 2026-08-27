import updaterPackage from 'electron-updater';
import { BrowserWindow, ipcMain, app } from 'electron';

import logger from '../utils/logger.js';
import { updateHealthStore } from './store.js';
import { IPC_CHANNELS } from '../ipc/channels.js';
import { normalizeDownloadProgress, normalizeUpdateCheckInterval } from './autoUpdatePolicy.js';

const { autoUpdater } = updaterPackage;

class AutoUpdateService {
  constructor() {
    this.isChecking = false;
    this.isDownloading = false;
    this.updateAvailable = false;
    this.updateDownloaded = false;
    this.isInstalling = false;
    this.updateInfo = null;
    this.downloadProgress = null;
    this.checkInterval = null;
    this.initialCheckTimer = null;
    this.healthCheckTimer = null;
    this.beforeInstall = null;
    this._configureUpdater();
    this._registerIPC();
  }

  _configureUpdater() {
    autoUpdater.autoDownload = false;
    // Nunca instalar sin una acción explícita del usuario.
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.allowPrerelease = false;
    autoUpdater.allowDowngrade = false;
    autoUpdater.logger = logger;

    autoUpdater.on('update-available', (info) => {
      this.updateAvailable = true;
      this.updateDownloaded = false;
      this.updateInfo = info;
      this.downloadProgress = null;
      this.isChecking = false;
      logger.info(`Actualización disponible: v${info.version}.`);
      this._notifyUI(IPC_CHANNELS.UPDATE_AVAILABLE, {
        version: info.version,
        releaseDate: info.releaseDate,
        currentVersion: autoUpdater.currentVersion.version,
      });
    });

    autoUpdater.on('update-not-available', (info) => {
      this.updateAvailable = false;
      this.updateDownloaded = false;
      this.updateInfo = null;
      this.downloadProgress = null;
      this.isChecking = false;
      this._notifyUI(IPC_CHANNELS.UPDATE_NOT_AVAILABLE, { version: info.version });
    });

    autoUpdater.on('download-progress', (progress) => {
      this.downloadProgress = normalizeDownloadProgress(progress);
      this._notifyUI(IPC_CHANNELS.UPDATE_DOWNLOAD_PROGRESS, this.downloadProgress);
    });

    autoUpdater.on('update-downloaded', (info) => {
      this.isDownloading = false;
      this.updateDownloaded = true;
      this.updateInfo = info;
      this.downloadProgress = {
        ...(this.downloadProgress || {}),
        percent: 100,
      };
      logger.info(`Actualización descargada: v${info.version}.`);
      this._notifyUI(IPC_CHANNELS.UPDATE_DOWNLOADED, { version: info.version });
    });

    autoUpdater.on('error', (error) => {
      this.isChecking = false;
      this.isDownloading = false;
      this.isInstalling = false;
      logger.error(`Error auto-update: ${error.message}`);
      this._notifyUI(IPC_CHANNELS.UPDATE_ERROR, {
        message: getFriendlyUpdateError(error),
      });
    });
  }

  async checkForUpdates() {
    if (this.isChecking || this.isDownloading) {
      return { success: true, skipped: true };
    }
    if (!app.isPackaged) {
      return {
        success: false,
        message: 'Las actualizaciones solo funcionan en la aplicación instalada.',
      };
    }

    this.isChecking = true;
    try {
      await autoUpdater.checkForUpdates();
      return { success: true };
    } catch (error) {
      this.isChecking = false;
      logger.error(`Error verificando actualizaciones: ${error.message}`);
      return {
        success: false,
        message: getFriendlyUpdateError(error),
      };
    }
  }

  async downloadUpdate() {
    if (!this.updateAvailable) {
      return { success: false, message: 'No hay una actualización disponible.' };
    }
    if (this.updateDownloaded) {
      return { success: true, downloaded: true };
    }
    if (this.isDownloading) {
      return { success: true, alreadyDownloading: true };
    }

    this.isDownloading = true;
    this.downloadProgress = { percent: 0 };
    this._notifyUI(IPC_CHANNELS.UPDATE_DOWNLOADING, { percent: 0 });

    try {
      await autoUpdater.downloadUpdate();
      return { success: true };
    } catch (error) {
      this.isDownloading = false;
      logger.error(`Error descargando actualización: ${error.message}`);
      const message = getFriendlyUpdateError(error);
      this._notifyUI(IPC_CHANNELS.UPDATE_ERROR, { message });
      return { success: false, message };
    }
  }

  async installAndRestart() {
    if (this.isInstalling) {
      return { success: true, alreadyInstalling: true };
    }
    if (!this.updateDownloaded) {
      return {
        success: false,
        message: 'La actualización todavía no terminó de descargarse.',
      };
    }

    this.isInstalling = true;
    try {
      await this.beforeInstall?.();
    } catch (error) {
      this.isInstalling = false;
      logger.error(`No se pudo preparar la instalación: ${error.message}`);
      return {
        success: false,
        message: error.message || 'No se pudo preparar la actualización.',
      };
    }

    updateHealthStore.setPending({
      previousVersion: app.getVersion(),
      targetVersion: this.updateInfo?.version,
      preparedAt: new Date().toISOString(),
    });

    try {
      autoUpdater.quitAndInstall(false, true);
      return { success: true };
    } catch (error) {
      this.isInstalling = false;
      logger.error(`No se pudo iniciar la instalación: ${error.message}`);
      return { success: false, message: 'No se pudo iniciar la instalación.' };
    }
  }

  setBeforeInstallHandler(handler) {
    this.beforeInstall = typeof handler === 'function' ? handler : null;
  }

  beginStartupHealthCheck() {
    const state = updateHealthStore.recordStartup(app.getVersion());
    if (state?.status === 'install-failed') {
      logger.error(
        `La instalación de v${state.targetVersion} no se completó; se conserva v${app.getVersion()}.`,
      );
      this._notifyUI(IPC_CHANNELS.UPDATE_ERROR, {
        message: 'La actualización no se instaló correctamente. Se conservó la versión anterior.',
      });
      return state;
    }
    if (state?.status === 'recovery-required') {
      logger.error(`v${app.getVersion()} se reinició antes de superar la verificación de salud.`);
      this.stopPeriodicCheck();
      this._notifyUI(IPC_CHANNELS.UPDATE_ERROR, {
        message: 'La versión actual no completó la verificación de estabilidad. Las actualizaciones automáticas quedaron pausadas; contacta a soporte.',
      });
      return state;
    }
    if (state?.status === 'verifying') {
      if (this.healthCheckTimer) clearTimeout(this.healthCheckTimer);
      this.healthCheckTimer = setTimeout(() => {
        updateHealthStore.markHealthy(app.getVersion());
        logger.info(`Versión v${app.getVersion()} verificada como estable después de actualizar.`);
        this.healthCheckTimer = null;
      }, 45_000);
    }
    return state;
  }

  startPeriodicCheck(intervalMinutes = 60) {
    this.stopPeriodicCheck();
    const safeIntervalMinutes = normalizeUpdateCheckInterval(intervalMinutes);
    this.initialCheckTimer = setTimeout(() => this.checkForUpdates(), 10000);
    this.checkInterval = setInterval(
      () => this.checkForUpdates(),
      safeIntervalMinutes * 60 * 1000,
    );
  }

  stopPeriodicCheck() {
    if (this.initialCheckTimer) clearTimeout(this.initialCheckTimer);
    if (this.checkInterval) clearInterval(this.checkInterval);
    this.initialCheckTimer = null;
    this.checkInterval = null;
  }

  _registerIPC() {
    const handlers = [
      [IPC_CHANNELS.UPDATE_CHECK, () => this.checkForUpdates()],
      [IPC_CHANNELS.UPDATE_DOWNLOAD, () => this.downloadUpdate()],
      [IPC_CHANNELS.UPDATE_INSTALL, () => this.installAndRestart()],
      [IPC_CHANNELS.UPDATE_GET_STATUS, () => this.getStatus()],
    ];

    handlers.forEach(([channel, handler]) => {
      ipcMain.removeHandler(channel);
      ipcMain.handle(channel, handler);
    });
  }

  _notifyUI(channel, data) {
    BrowserWindow.getAllWindows().forEach((window) => {
      if (!window.isDestroyed()) window.webContents.send(channel, data);
    });
  }

  getStatus() {
    return {
      isChecking: this.isChecking,
      isDownloading: this.isDownloading,
      isInstalling: this.isInstalling,
      updateAvailable: this.updateAvailable,
      updateDownloaded: this.updateDownloaded,
      availableVersion: this.updateInfo?.version || null,
      downloadProgress: this.downloadProgress,
      currentVersion: autoUpdater.currentVersion?.version || app.getVersion(),
      health: updateHealthStore.get(),
    };
  }

  destroy() {
    this.stopPeriodicCheck();
    if (this.healthCheckTimer) clearTimeout(this.healthCheckTimer);
    this.healthCheckTimer = null;
  }
}

export default new AutoUpdateService();

function getFriendlyUpdateError(error) {
  const message = String(
    error?.message || '',
  );

  if (
    message.includes('latest.yml') ||
    message.includes('Cannot find latest')
  ) {
    return 'La actualización publicada está incompleta. Inténtalo nuevamente más tarde.';
  }

  if (
    message.includes('404') ||
    message.includes('HttpError')
  ) {
    return 'No se encontraron todos los archivos de la actualización. Inténtalo más tarde.';
  }

  if (
    /ENOTFOUND|ECONN|ETIMEDOUT|network/i.test(
      message,
    )
  ) {
    return 'No se pudo consultar la actualización. Verifica tu conexión a internet.';
  }

  return 'No se pudo completar la actualización. Inténtalo nuevamente más tarde.';
}
