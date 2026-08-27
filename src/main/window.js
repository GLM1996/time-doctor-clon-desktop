import {
  app,
  BrowserWindow,
  shell,
} from 'electron';

import path from 'path';
import { fileURLToPath } from 'url';

import logger from './utils/logger.js';
import crashReporterService from './services/crashReporterService.js';
import {
  isAllowedExternalUrl,
  isAllowedRendererNavigation,
} from './windowNavigationPolicy.js';

const __filename = fileURLToPath(
  import.meta.url,
);

const __dirname = path.dirname(
  __filename,
);

let mainWindow = null;

export function createMainWindow({
  shouldQuit = () => false,
  onCloseToTray = () => {},
} = {}) {
  const isDev = !app.isPackaged;

  const preloadPath = path.join(
    __dirname,
    '../preload/preload.cjs',
  );

  const iconPath = path.join(
    __dirname,
    '../../assets/icon.png',
  );

  mainWindow = new BrowserWindow({
    width: 520,
    height: 620,

    minWidth: 460,
    minHeight: 560,

    resizable: true,
    maximizable: true,

    center: true,
    show: false,

    title: 'LogYourTime',
    autoHideMenuBar: true,

    backgroundColor: '#f4f1e9',

    icon: iconPath,

    webPreferences: {
      preload: preloadPath,

      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,

      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });

  mainWindow.webContents.session.setPermissionRequestHandler(
    (_webContents, _permission, callback) => callback(false),
  );

  const rendererFile = path.join(
    __dirname,
    '../renderer/index.html',
  );
  mainWindow.webContents.session.setPermissionCheckHandler(() => false);

  /*
   * Carga del renderer.
   *
   * Verifica que la ruta de producción coincida
   * con la carpeta generada por tu proceso de build.
   */
  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(
      process.env.ELECTRON_RENDERER_URL,
    );

    /*
    mainWindow.webContents.openDevTools({
      mode: 'detach',
    });
    */
  } else {
    mainWindow.loadFile(rendererFile);
  }

  /*
   * Impide que window.open() cree ventanas
   * arbitrarias dentro de Electron.
   *
   * Los enlaces HTTPS se abren en el navegador
   * predeterminado del usuario.
   */
  mainWindow.webContents.setWindowOpenHandler(
    ({ url }) => {
      if (isAllowedExternalUrl(url)) {
        shell.openExternal(url).catch(
          (error) => {
            logger.error(
              `Error abriendo enlace externo: ${error.message}`,
            );
          },
        );
      }

      return {
        action: 'deny',
      };
    },
  );

  /*
   * Evita que el renderer reemplace la aplicación
   * navegando directamente hacia una página externa.
   */
  mainWindow.webContents.on(
    'will-navigate',
    (event, url) => {
      if (isAllowedRendererNavigation(url, {
        isDev,
        rendererDevUrl: process.env.ELECTRON_RENDERER_URL,
        rendererFile,
      })) {
        return;
      }

      event.preventDefault();

      if (isAllowedExternalUrl(url)) {
        shell.openExternal(url).catch(
          (error) => {
            logger.error(
              `Error abriendo navegación externa: ${error.message}`,
            );
          },
        );
      }
    },
  );

  /*
   * Registrar fallos al cargar el renderer.
   */
  mainWindow.webContents.on(
    'did-fail-load',
    (
      _event,
      errorCode,
      errorDescription,
      validatedURL,
    ) => {
      logger.error(
        [
          'No se pudo cargar el renderer.',
          `Código: ${errorCode}.`,
          `Descripción: ${errorDescription}.`,
          `URL: ${validatedURL}.`,
        ].join(' '),
      );
    },
  );

  mainWindow.webContents.on(
    'render-process-gone',
    (_event, details) => {
      logger.error(
        `El proceso de interfaz terminó inesperadamente: ${details.reason}.`,
      );
      crashReporterService.capture({ eventType: 'render-process-gone', message: `Renderer terminated: ${details.reason}`, processType: 'renderer', severity: 'fatal' });
    },
  );

  mainWindow.on('unresponsive', () => {
    logger.warn('La ventana principal dejó de responder temporalmente.');
    crashReporterService.capture({ eventType: 'unresponsive', message: 'Main window became unresponsive', processType: 'renderer', severity: 'warning' });
  });

  mainWindow.once(
    'ready-to-show',
    () => {
      if (
        !mainWindow ||
        mainWindow.isDestroyed()
      ) {
        return;
      }

      mainWindow.show();
      mainWindow.focus();

      logger.info(
        'Ventana principal mostrada',
      );
    },
  );

  /*
   * El botón X cerrará normalmente la ventana.
   *
   * No hace falta interceptar "close" cuando
   * quieres que la aplicación se cierre.
   */
  mainWindow.on('minimize', (event) => {
    if (shouldQuit()) return;

    event.preventDefault();
    mainWindow.hide();
    onCloseToTray();

    logger.info(
      'Ventana principal minimizada en la bandeja del sistema.',
    );
  });

  mainWindow.on('close', (event) => {
    if (shouldQuit()) return;

    event.preventDefault();
    mainWindow.hide();
    onCloseToTray();

    logger.info(
      'Ventana principal ocultada en la bandeja del sistema.',
    );
  });

  mainWindow.on('closed', () => {
    mainWindow = null;

    logger.info(
      'Ventana principal cerrada',
    );
  });

  return mainWindow;
}

export function getMainWindow() {
  if (
    !mainWindow ||
    mainWindow.isDestroyed()
  ) {
    return null;
  }

  return mainWindow;
}

