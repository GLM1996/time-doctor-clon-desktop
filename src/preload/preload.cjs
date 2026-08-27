const {
  contextBridge,
  ipcRenderer,
} = require('electron');

const reportRendererError = (eventType, reason) => {
  const error = reason instanceof Error ? reason : null;
  ipcRenderer.send('app:renderer-error', {
    eventType,
    message: String(error?.message || reason || 'Unknown renderer error').slice(0, 500),
    stack: error?.stack ? String(error.stack).slice(0, 8000) : null,
    severity: 'error',
  });
};

window.addEventListener('error', (event) => reportRendererError('window.error', event.error || event.message));
window.addEventListener('unhandledrejection', (event) => reportRendererError('unhandledrejection', event.reason));

/*
 * Canales que solamente envían una instrucción
 * al proceso principal y no esperan respuesta.
 */
const ALLOWED_SEND_CHANNELS = [
  'app:quit',
  'app:minimize',
  'app:connection-hint',
];

/*
 * Canales que ejecutan una solicitud y esperan
 * una respuesta del proceso principal.
 */
const ALLOWED_INVOKE_CHANNELS = [
  'app:get-version',
  'app:get-platform',
  'app:open-external',

  'auth:login',
  'auth:logout',
  'auth:get-status',
  'auth:get-saved-credentials',

  'timer:start',
  'timer:stop',
  'timer:get-status',
  'timer:get-work-options',
  'timer:get-breaks',
  'timer:start-break',
  'timer:stop-break',

  'screenshot:start',
  'screenshot:stop',
  'screenshot:get-status',
  'screenshot:take-manual',
  'screenshot:process-queue',

  'time:get-today-total',

  // 👇 NUEVO: Auto-update
  'update:check',
  'update:download',
  'update:install',
  'update:get-status',
];

/*
 * Eventos que el proceso principal puede enviar
 * al renderer.
 */
const ALLOWED_RECEIVE_CHANNELS = [
  'event:notification',
  'event:timer-update',
  'event:sync-update',
  'event:screenshot-update',
  'event:activity-update',
  'event:session-closed',
  'event:break-ended',
  'event:idle-countdown',
  'event:idle-notification',

  'event:connection-status',
  'event:auth-expired',

  // 👇 NUEVO: Auto-update
  'update:available',
  'update:not-available',
  'update:downloading',
  'update:download-progress',
  'update:downloaded',
  'update:error',
];

/*
 * Valida que el canal sea un string y se encuentre
 * dentro de la lista permitida.
 */
function isAllowedChannel(
  channel,
  allowedChannels,
) {
  return (
    typeof channel === 'string' &&
    allowedChannels.includes(channel)
  );
}

/*
 * Envía un evento sin esperar respuesta.
 */
function send(channel, data) {
  if (
    !isAllowedChannel(
      channel,
      ALLOWED_SEND_CHANNELS,
    )
  ) {
    console.warn(
      `[preload] Canal send no permitido: ${channel}`,
    );

    return false;
  }

  ipcRenderer.send(channel, data);

  return true;
}

/*
 * Ejecuta una solicitud IPC y devuelve una promesa.
 */
function invoke(channel, data) {
  if (
    !isAllowedChannel(
      channel,
      ALLOWED_INVOKE_CHANNELS,
    )
  ) {
    return Promise.reject(
      new Error(
        `Canal invoke no permitido: ${channel}`,
      ),
    );
  }

  return ipcRenderer.invoke(
    channel,
    data,
  );
}

/*
 * Registra un listener permitido.
 *
 * Devuelve una función para eliminar exactamente
 * el listener registrado por el componente.
 */
function on(channel, callback) {
  if (
    !isAllowedChannel(
      channel,
      ALLOWED_RECEIVE_CHANNELS,
    )
  ) {
    console.warn(
      `[preload] Canal receive no permitido: ${channel}`,
    );

    return () => {};
  }

  if (typeof callback !== 'function') {
    console.warn(
      `[preload] Callback inválido para: ${channel}`,
    );

    return () => {};
  }

  const subscription = (
    _event,
    ...args
  ) => {
    callback(...args);
  };

  ipcRenderer.on(
    channel,
    subscription,
  );

  return () => {
    ipcRenderer.removeListener(
      channel,
      subscription,
    );
  };
}

contextBridge.exposeInMainWorld(
  'electronAPI',
  {
    /*
     * Métodos genéricos.
     */
    /*
     * Métodos directos para que los componentes
     * no tengan que conocer los nombres de canales.
     */
    quitApp: () => {
      return send('app:quit');
    },

    minimizeApp: () => {
      return send('app:minimize');
    },

    reportConnectionStatus: (online) => {
      return send(
        'app:connection-hint',
        { online: Boolean(online) },
      );
    },

    getAppVersion: () => {
      return invoke(
        'app:get-version',
      );
    },

    getPlatform: () => {
      return invoke(
        'app:get-platform',
      );
    },

    openExternal: (url) => {
      return invoke(
        'app:open-external',
        {
          url,
        },
      );
    },

    login: (credentials) => {
      return invoke(
        'auth:login',
        credentials,
      );
    },

    logout: () => {
      return invoke(
        'auth:logout',
      );
    },

    getAuthStatus: () => {
      return invoke(
        'auth:get-status',
      );
    },

    getSavedCredentials: () => {
      return invoke('auth:get-saved-credentials');
    },

    getWorkOptions: () => invoke('timer:get-work-options'),
    getBreaks: () => invoke('timer:get-breaks'),
    startBreak: (data = {}) => invoke('timer:start-break', data),
    stopBreak: () => invoke('timer:stop-break'),

    startTimer: (data = {}) => {
      return invoke(
        'timer:start',
        data,
      );
    },

    stopTimer: (data = {}) => {
      return invoke(
        'timer:stop',
        data,
      );
    },

    getTimerStatus: () => {
      return invoke(
        'timer:get-status',
      );
    },

    getTodayTotal: () => {
      return invoke(
        'time:get-today-total',
      );
    },

    getScreenshotStatus: () => invoke('screenshot:get-status'),
    takeManualScreenshot: () => invoke('screenshot:take-manual'),
    processScreenshotQueue: () => invoke('screenshot:process-queue'),

    events: {
      onConnectionStatus: (callback) => on('event:connection-status', callback),
      onAuthExpired: (callback) => on('event:auth-expired', callback),
      onSessionClosed: (callback) => on('event:session-closed', callback),
      onBreakEnded: (callback) => on('event:break-ended', callback),
      onTimerUpdate: (callback) => on('event:timer-update', callback),
      onSyncUpdate: (callback) => on('event:sync-update', callback),
      onScreenshotUpdate: (callback) => on('event:screenshot-update', callback),
      onActivityUpdate: (callback) => on('event:activity-update', callback),
      onIdleCountdown: (callback) => on('event:idle-countdown', callback),
      onIdleNotification: (callback) => on('event:idle-notification', callback),
    },

    // ==========================================
    // 👇 NUEVO: Auto-update
    // ==========================================
    update: {
      check: () => {
        return invoke('update:check');
      },

      download: () => {
        return invoke('update:download');
      },

      install: () => {
        return invoke('update:install');
      },

      getStatus: () => {
        return invoke('update:get-status');
      },

      onAvailable: (callback) => {
        return on('update:available', callback);
      },

      onNotAvailable: (callback) => {
        return on('update:not-available', callback);
      },

      onDownloading: (callback) => {
        return on('update:downloading', callback);
      },

      onDownloadProgress: (callback) => {
        return on('update:download-progress', callback);
      },

      onDownloaded: (callback) => {
        return on('update:downloaded', callback);
      },

      onError: (callback) => {
        return on('update:error', callback);
      },
    },
  },
);
