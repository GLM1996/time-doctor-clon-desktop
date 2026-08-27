export const IPC_CHANNELS = {
  // ========================================
  // APP
  // ========================================
  APP_GET_VERSION: 'app:get-version',
  APP_GET_PLATFORM: 'app:get-platform',
  APP_OPEN_EXTERNAL: 'app:open-external',
  APP_QUIT: 'app:quit',
  APP_MINIMIZE: 'app:minimize',
  APP_CONNECTION_HINT: 'app:connection-hint',

  // ========================================
  // AUTH
  // ========================================
  AUTH_LOGIN: 'auth:login',
  AUTH_LOGOUT: 'auth:logout',
  AUTH_GET_STATUS: 'auth:get-status',
  AUTH_GET_SAVED_CREDENTIALS: 'auth:get-saved-credentials',

  // ========================================
  // TIMER
  // ========================================
  TIMER_START: 'timer:start',
  TIMER_STOP: 'timer:stop',
  TIMER_GET_STATUS: 'timer:get-status',
  TIMER_GET_WORK_OPTIONS: 'timer:get-work-options',
  TIMER_GET_BREAKS: 'timer:get-breaks',
  TIMER_START_BREAK: 'timer:start-break',
  TIMER_STOP_BREAK: 'timer:stop-break',

  /*
   * Evento interno o main → renderer.
   * No necesita ipcMain.handle si solo se emite.
   */
  TIMER_TICK: 'timer:tick',

  TIME_GET_TODAY_TOTAL: 'time:get-today-total',

  // ========================================
  // SCREENSHOTS
  // ========================================
  SCREENSHOT_START: 'screenshot:start',
  SCREENSHOT_STOP: 'screenshot:stop',
  SCREENSHOT_GET_STATUS: 'screenshot:get-status',
  SCREENSHOT_TAKE_MANUAL: 'screenshot:take-manual',
  SCREENSHOT_PROCESS_QUEUE: 'screenshot:process-queue',

  // ========================================
  // EVENTS MAIN → RENDERER
  // ========================================
  EVENT_NOTIFICATION: 'event:notification',
  EVENT_TIMER_UPDATE: 'event:timer-update',
  EVENT_SYNC_UPDATE: 'event:sync-update',
  EVENT_SCREENSHOT_UPDATE: 'event:screenshot-update',
  EVENT_ACTIVITY_UPDATE: 'event:activity-update',
  EVENT_SESSION_CLOSED: 'event:session-closed',
  EVENT_BREAK_ENDED: 'event:break-ended',
  EVENT_IDLE_COUNTDOWN: 'event:idle-countdown',
  EVENT_IDLE_NOTIFICATION: 'event:idle-notification',
  EVENT_CONNECTION_STATUS: 'event:connection-status',
  EVENT_AUTH_EXPIRED: 'event:auth-expired',

  UPDATE_CHECK: 'update:check',
  UPDATE_DOWNLOAD: 'update:download',
  UPDATE_INSTALL: 'update:install',
  UPDATE_GET_STATUS: 'update:get-status',
  UPDATE_AVAILABLE: 'update:available',
  UPDATE_NOT_AVAILABLE: 'update:not-available',
  UPDATE_DOWNLOADING: 'update:downloading',
  UPDATE_DOWNLOAD_PROGRESS: 'update:download-progress',
  UPDATE_DOWNLOADED: 'update:downloaded',
  UPDATE_ERROR: 'update:error',
};
