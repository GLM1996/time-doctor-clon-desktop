import { app, BrowserWindow, session } from 'electron';
import { createMainWindow } from './window.js';
import { registerIpcHandlers } from './ipc/handlers.js';
import logger from './utils/logger.js';
import { appPreferenceStore, authStore } from './services/store.js';
import apiClient from './services/apiClient.js';
import timerService from './services/timerService.js';
import trayService from './services/trayService.js';
import connectionService from './services/connectionService.js';
import screenshotService from './services/screenshotService.js';
import crashReporterService from './services/crashReporterService.js';
import configService from './services/configService.js';
import { IPC_CHANNELS } from './ipc/channels.js';
import { settleWithTimeout } from './services/shutdownPolicy.js';
import autoUpdateService from './services/autoUpdateService.js'; // 👇 NUEVO
import activityService from './services/activityService.js';
import browserDomainBridge from './services/browserDomainBridge.js';
import windowsBrowserUrlService from './services/windowsBrowserUrlService.js';
import windowsStartupService from './services/windowsStartupService.js';

const gotTheLock = app.requestSingleInstanceLock();

process.on('uncaughtException', (error) => {
  logger.error(`Error no controlado: ${error.stack || error.message}`);
  crashReporterService.capture({ eventType: 'uncaughtException', message: error.message, stack: error.stack, processType: 'main', severity: 'fatal' });
});

process.on('unhandledRejection', (reason) => {
  logger.error(
    `Promesa rechazada sin controlar: ${
      reason instanceof Error ? reason.stack || reason.message : String(reason)
    }`,
  );
  crashReporterService.capture({ eventType: 'unhandledRejection', message: reason instanceof Error ? reason.message : String(reason), stack: reason instanceof Error ? reason.stack : null, processType: 'main', severity: 'error' });
});

if (!gotTheLock) {
  app.quit();
} else {
  let mainWindow = null;
  let isQuitting = false;
  let unsubscribeNativeBrowserCollector = null;

  const requestQuit = async () => {
    if (isQuitting) return;
    isQuitting = true;

    if (timerService.getStatus().isRunning) {
      try {
        await settleWithTimeout(
          timerService.stop('system'),
          5000,
          'Tiempo de espera agotado al cerrar la jornada.',
        );
      } catch (error) {
        logger.warn(
          `No se confirmó el cierre remoto; se completará mediante la sincronización pendiente: ${error.message}`,
        );
        timerService.prepareForShutdown();
      }
    }

    const forcedExitTimer = setTimeout(() => app.exit(0), 2000);
    forcedExitTimer.unref?.();
    app.quit();
  };

  const createWindow = () =>
    createMainWindow({
      shouldQuit: () => isQuitting,
      onCloseToTray: () => trayService.notifyCloseToTray(),
    });

  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    crashReporterService.start();
    windowsStartupService.setEnabled(appPreferenceStore.getStartWithWindows());
    if (app.isPackaged) {
      session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
        callback({
          responseHeaders: {
            ...details.responseHeaders,
            'Content-Security-Policy': [
              "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
            ],
          },
        });
      });
    }

    logger.info('🚀 Electron listo');
    logger.info(`📝 Ambiente: ${process.env.NODE_ENV || 'development'}`);

    browserDomainBridge.start({
      onDomain: (message) => activityService.updateBrowserDomain(message),
    });
    unsubscribeNativeBrowserCollector = timerService.onStatusChange((status) => {
      if (status.isRunning) {
        windowsBrowserUrlService.start({
          onDomain: (message) => activityService.updateNativeBrowserDomain(message),
        });
      } else {
        windowsBrowserUrlService.stop();
      }
    });

    // Restaurar token del store al iniciar
    const savedToken = authStore.getToken();
    if (savedToken) {
      apiClient.setToken(savedToken);
      crashReporterService.flush().catch(() => {});
      logger.info('🔑 Token restaurado desde el almacenamiento');
    }

    // 👇 Auto-update: solo en producción
    if (app.isPackaged) {
      autoUpdateService.setBeforeInstallHandler(async () => {
        if (timerService.getStatus().isRunning) {
          try {
            await settleWithTimeout(
              timerService.stop('system'),
              5000,
              'Tiempo de espera agotado preparando la actualización.',
            );
          } catch (error) {
            logger.warn(`El cierre remoto se sincronizará después: ${error.message}`);
            timerService.prepareForShutdown();
          }
        }
      });
      autoUpdateService.startPeriodicCheck(60);
    } else {
      logger.info('🔄 Modo desarrollo: auto-update desactivado');
    }

    // Registrar handlers IPC
    registerIpcHandlers({ onQuit: requestQuit });

    // Crear ventana principal
    mainWindow = createWindow();
    if (app.isPackaged) autoUpdateService.beginStartupHealthCheck();
    trayService.initialize({
      getMainWindow: () => mainWindow,
      onQuit: requestQuit,
    });
    const syncPendingData = async () => {
      const timerStatus = timerService.getStatus();
      if (timerService.getSyncStatus().pendingTotal === 0 && !timerStatus.isOffline) {
        await crashReporterService.flush();
        return;
      }
      await Promise.allSettled([
        timerService.syncPendingData(),
        screenshotService.processQueue(),
        crashReporterService.flush(),
      ]);
    };
    connectionService.start({
      onReconnect: syncPendingData,
      onHealthy: syncPendingData,
    });
    apiClient.onAuthExpired(() => {
      timerService.prepareForShutdown();
      trayService.refreshIdentity();
      BrowserWindow.getAllWindows().forEach((window) => {
        if (!window.isDestroyed()) {
          window.webContents.send(IPC_CHANNELS.EVENT_AUTH_EXPIRED, {
            message: 'Tu sesión expiró. Inicia sesión nuevamente para continuar.',
          });
        }
      });
    });
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
    } else {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  // 👇 NUEVO: Limpiar auto-update al cerrar
  app.on('before-quit', () => {
    isQuitting = true;
    timerService.prepareForShutdown();
    screenshotService.destroy();
    configService.destroy();
    autoUpdateService.destroy();
    trayService.destroy();
    connectionService.destroy();
    browserDomainBridge.stop();
    unsubscribeNativeBrowserCollector?.();
    unsubscribeNativeBrowserCollector = null;
    windowsBrowserUrlService.stop();
    logger.info('👋 Cerrando aplicación...');
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}
