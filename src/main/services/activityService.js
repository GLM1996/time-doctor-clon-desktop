import { activeWindow } from 'get-windows';
import { isDomainExcluded, normalizeActiveDomain } from './activeDomain.js';
import { powerMonitor, BrowserWindow, app } from 'electron';
import logger from '../utils/logger.js';
import apiClient from './apiClient.js';
import timerService from './timerService.js';
import path from 'path';
import secureLocalStorage from './secureLocalStorage.js';
import {
  isOfflineItemReady,
  linkOfflineSnapshots,
  reconcileQueueAfterProcessing,
  scheduleOfflineRetry,
} from './offlineQueuePolicy.js';
import {
  calculateActivityPercentage,
  getActivityStatus,
  isClosedSessionActivityError,
  isRetryableActivityError,
} from './activityPolicy.js';
import { normalizeActivityRuntimeOptions } from './activityRuntimeOptions.js';
import ActivityQueueRepository from './activityQueueRepository.js';
import { createActivitySnapshot, toActivityApiPayload } from './activitySnapshot.js';
import {
  accumulateActivityTime,
  advanceActivityWindow,
  calculateTickDelta,
} from './activityTick.js';
import { evaluateIdleState } from './idleStatePolicy.js';
import { buildActivityUiUpdate, evaluateLowActivityAlert } from './activityUiState.js';
import { isAuthenticationRequiredError } from './authRefreshPolicy.js';
import { shouldCreateActivitySnapshot } from './activityCapturePolicy.js';
import { quarantineLocalPath } from './localDataRecovery.js';

const ACTIVITY_INPUT_WINDOW_SECONDS = 30;
const ACTIVE_WINDOW_REFRESH_SECONDS = 5;
const BROWSER_DOMAIN_MAX_AGE_MS = 90 * 1000;
const SUPPORTED_BROWSER_PATTERN =
  /(chrome|msedge|edge|brave|chromium|opera|vivaldi)/i;

class ActivityService {
  constructor() {
    this.isMonitoring = false;

    this.activityWindow1Min = new Array(60).fill(false);
    this.activityWindow5Min = new Array(300).fill(false);

    this.activityTickInterval = null;
    this.windowNameInterval = null;
    this.reportIntervalId = null;

    this.reportIntervalSeconds = 60;
    this.idleThresholdSeconds = 5 * 60;
    this.autoCloseInactiveSeconds = 10 * 60;
    this.idleWarningSeconds = 8 * 60;
    this.lowActivityThreshold = 30;
    this.maxOfflineDays = 7;
    this.maxQueueSize = 10000;

    this.trackActiveWindow = true;
    this.desktopNotificationsEnabled = true;
    this.inactivityAlertEnabled = true;
    this.lowActivityAlertEnabled = true;

    this.idleStartTime = null;
    this.warningSent = false;
    this.lowActivityWarningSent = false;

    this.currentActiveWindow = null;
    this.currentActiveApp = null;
    this.currentActiveDomain = null;
    this.browserDomain = null;
    this.browserDomainObservedAt = 0;
    this.nativeBrowserDomain = null;
    this.nativeBrowserDomainObservedAt = 0;
    this.systemIdleTime = 0;

    this.cumulativeActiveTime = 0;
    this.cumulativeIdleTime = 0;
    this.lastTickTime = null;

    this.activityQueue = [];
    this.processingQueuePromise = null;
    this.activityQueuePath = path.join(
      app.getPath('userData'),
      'activity-queue.json'
    );
    this.activityQueueRepository = new ActivityQueueRepository({
      filePath: this.activityQueuePath,
      storage: secureLocalStorage,
    });

    this._loadActivityQueue();
  }

  start(options = {}) {
    if (this.isMonitoring) {
      return;
    }

    this._applyOptions(options);

    this.isMonitoring = true;

    this.cumulativeActiveTime = 0;
    this.cumulativeIdleTime = 0;
    this.lastTickTime = Date.now();

    this.systemIdleTime = 0;
    this.idleStartTime = null;
    this.warningSent = false;
    this.lowActivityWarningSent = false;

    this.currentActiveWindow = null;
    this.currentActiveApp = null;
    this.currentActiveDomain = null;
    this.browserDomain = null;
    this.browserDomainObservedAt = 0;
    this.nativeBrowserDomain = null;
    this.nativeBrowserDomainObservedAt = 0;

    this.activityWindow1Min.fill(false);
    this.activityWindow5Min.fill(false);

    this.activityTickInterval = setInterval(
      () => this._tick(),
      1000
    );

    if (this.trackActiveWindow) {
      this.windowNameInterval = setInterval(
        () => this._updateActiveWindowName(),
        ACTIVE_WINDOW_REFRESH_SECONDS * 1000
      );

      this._updateActiveWindowName();
    }

    this.reportIntervalId = setInterval(
      () => this._sendSnapshotToBackend(),
      this.reportIntervalSeconds * 1000
    );

    logger.info(
      `⌨️ Monitoreo iniciado. Reporte cada ${this.reportIntervalSeconds}s, cierre inactivo a los ${this.autoCloseInactiveSeconds}s.`
    );
  }

  stop() {
    if (!this.isMonitoring) {
      return;
    }

    this.isMonitoring = false;

    if (this.activityTickInterval) {
      clearInterval(this.activityTickInterval);
      this.activityTickInterval = null;
    }

    if (this.windowNameInterval) {
      clearInterval(this.windowNameInterval);
      this.windowNameInterval = null;
    }

    if (this.reportIntervalId) {
      clearInterval(this.reportIntervalId);
      this.reportIntervalId = null;
    }

    this.idleStartTime = null;
    this.warningSent = false;
    this.lowActivityWarningSent = false;
    this.lastTickTime = null;

    logger.info('⌨️ Monitoreo detenido');
  }

  _applyOptions(options) {
    Object.assign(this, normalizeActivityRuntimeOptions(options));
  }

  reconfigure(options = {}) {
    const wasMonitoring = this.isMonitoring;
    const previousReportInterval = this.reportIntervalSeconds;
    const previousTrackActiveWindow = this.trackActiveWindow;
    this._applyOptions(options);

    if (!wasMonitoring) return;

    if (previousReportInterval !== this.reportIntervalSeconds) {
      if (this.reportIntervalId) clearInterval(this.reportIntervalId);
      this.reportIntervalId = setInterval(
        () => this._sendSnapshotToBackend(),
        this.reportIntervalSeconds * 1000,
      );
    }

    if (previousTrackActiveWindow !== this.trackActiveWindow) {
      if (this.windowNameInterval) clearInterval(this.windowNameInterval);
      this.windowNameInterval = null;
      if (this.trackActiveWindow) {
        this.windowNameInterval = setInterval(
          () => this._updateActiveWindowName(),
          ACTIVE_WINDOW_REFRESH_SECONDS * 1000,
        );
        this._updateActiveWindowName();
      } else {
        this.currentActiveWindow = null;
        this.currentActiveApp = null;
        this.currentActiveDomain = null;
      }
    }

    logger.info('Configuración de actividad actualizada sin reiniciar sus contadores.');
  }

  _tick() {
    if (!this.isMonitoring) {
      return;
    }

    const now = Date.now();

    if (!this.lastTickTime) {
      this.lastTickTime = now;
      return;
    }

    const tickDelta = calculateTickDelta({
      now,
      lastTickTime: this.lastTickTime,
    });
    const deltaSeconds = tickDelta.seconds;

    if (deltaSeconds < 1) {
      return;
    }

    /*
     * Cuando Windows se suspende, no contamos todo el tiempo
     * transcurrido como actividad laboral.
     */
    if (tickDelta.suspendedSeconds > 0) {
      logger.warn(
        `⚠️ Suspensión o congelamiento detectado: ${tickDelta.suspendedSeconds}s. Solo se procesará un segundo.`
      );

    }

    this.lastTickTime = now;

    try {
      this.systemIdleTime = powerMonitor.getSystemIdleTime();
    } catch (error) {
      logger.debug(
        `No se pudo consultar la inactividad del sistema: ${error.message}`
      );

      this.systemIdleTime = this.idleThresholdSeconds;
    }

    /*
     * Esta ventana de 30 segundos no determina el cierre.
     * Solo indica si hubo interacción reciente con teclado o mouse.
     */
    const hasRecentInput =
      this.systemIdleTime < ACTIVITY_INPUT_WINDOW_SECONDS;

    this.activityWindow1Min = advanceActivityWindow(
      this.activityWindow1Min,
      hasRecentInput,
      deltaSeconds,
    );
    this.activityWindow5Min = advanceActivityWindow(
      this.activityWindow5Min,
      hasRecentInput,
      deltaSeconds,
    );

    const cumulative = accumulateActivityTime({
      activeTime: this.cumulativeActiveTime,
      idleTime: this.cumulativeIdleTime,
      hasRecentInput,
      seconds: deltaSeconds,
    });
    this.cumulativeActiveTime = cumulative.activeTime;
    this.cumulativeIdleTime = cumulative.idleTime;

    this._sendActivityUpdateToUI(hasRecentInput);
    this._checkLowActivity();
    this._checkInactivity();
  }

  _sendActivityUpdateToUI(hasRecentInput) {
    const activityPercentage =
      this._getActivityPercentage1Min();

    const status = this._getCurrentStatus(
      activityPercentage,
      hasRecentInput
    );

    const update = buildActivityUiUpdate({
      activityPercentage,
      status,
      trackActiveWindow: this.trackActiveWindow,
      activeWindow: this.currentActiveWindow,
      activeApp: this.currentActiveApp,
      systemIdleTime: this.systemIdleTime,
      activeTime: this.cumulativeActiveTime,
      idleTime: this.cumulativeIdleTime,
    });

    BrowserWindow.getAllWindows().forEach(window => {
      if (!window.isDestroyed()) {
        window.webContents.send('event:activity-update', update);
      }
    });
  }

  _checkLowActivity() {
    const alertState = evaluateLowActivityAlert({
      percentage: this._getActivityPercentage1Min(),
      threshold: this.lowActivityThreshold,
      totalMeasuredSeconds: this.cumulativeActiveTime + this.cumulativeIdleTime,
      warningSent: this.lowActivityWarningSent,
      desktopNotificationsEnabled: this.desktopNotificationsEnabled,
      lowActivityAlertEnabled: this.lowActivityAlertEnabled,
    });

    if (alertState.shouldResetWarning) {
      this.lowActivityWarningSent = false;
      return;
    }

    if (!alertState.shouldNotify) return;
    this.lowActivityWarningSent = true;
    this._notifyUser('low-activity', {
      message: `Tu actividad del último minuto está en ${alertState.percentage}%.`,
      activityPercentage: alertState.percentage,
      threshold: this.lowActivityThreshold,
    });
  }

  _checkInactivity() {
    const idleState = evaluateIdleState({
      systemIdleTime: this.systemIdleTime,
      idleThresholdSeconds: this.idleThresholdSeconds,
      idleWarningSeconds: this.idleWarningSeconds,
      autoCloseInactiveSeconds: this.autoCloseInactiveSeconds,
      idleStartTime: this.idleStartTime,
      warningSent: this.warningSent,
    });

    if (idleState.phase === 'active') {
      if (idleState.shouldResetWarning) this._sendIdleCountdown(0);
      this.idleStartTime = null;
      this.warningSent = false;
      return;
    }

    this.idleStartTime = idleState.idleStartTime;
    const idleDuration = idleState.idleDuration;
    this._sendIdleCountdown(idleDuration);

    if (idleState.shouldWarn) {
      this.warningSent = true;

      logger.warn(
        `⚠️ Usuario inactivo por ${idleDuration}s.`
      );

      if (
        this.desktopNotificationsEnabled &&
        this.inactivityAlertEnabled
      ) {
        this._bringWindowToFront();

        this._notifyUser('idle-warning', {
          message:
            '¿Sigues ahí? La jornada se cerrará automáticamente si no se detecta actividad.',
          secondsUntilClose: idleState.secondsUntilClose
        });
      }
    }

    if (!idleState.shouldClose) {
      return;
    }

    logger.warn(
      `🚫 Cierre automático por inactividad: ${idleDuration}s.`
    );

    if (
      this.desktopNotificationsEnabled &&
      this.inactivityAlertEnabled
    ) {
      this._notifyUser('idle-close', {
        message:
          'Tu jornada fue cerrada automáticamente por inactividad.'
      });
    }

    /*
     * Detenemos primero este servicio para evitar múltiples
     * llamadas a timerService.stop mientras se procesa el cierre.
     */
    this.stop();

    timerService
      .stop(
        'inactivity',
        'Cierre automático por inactividad'
      )
      .then(() => {
        logger.info(
          '✅ Jornada cerrada automáticamente por inactividad.'
        );
      })
      .catch(error => {
        logger.error(
          `❌ Error cerrando jornada por inactividad: ${error.message}`
        );
      });
  }

  async _updateActiveWindowName() {
    if (!this.trackActiveWindow || !this.isMonitoring) {
      return;
    }

    try {
      const windowInfo = await activeWindow();

      if (!windowInfo) {
        this.currentActiveWindow = null;
        this.currentActiveApp = null;
        this.currentActiveDomain = null;
        return;
      }

      this.currentActiveApp =
        windowInfo.owner?.name || 'Desconocido';
      // get-windows solo entrega una URL fiable en navegadores compatibles de macOS.
      // Conservamos únicamente el hostname para minimizar la información capturada.
      const nativeDomain = normalizeActiveDomain(windowInfo.url);
      const extensionDomain = this._getFreshBrowserDomain(
        this.currentActiveApp,
      );
      this.currentActiveDomain = nativeDomain || extensionDomain;
      const excluded = isDomainExcluded(this.currentActiveDomain, this.excludedDomains);
      this.currentActiveWindow = excluded ? null : (windowInfo.title || 'Sin título');
      if (excluded) this.currentActiveDomain = null;
    } catch (error) {
      logger.debug(
        `No se pudo obtener la ventana activa: ${error.message}`
      );
    }
  }

  _bringWindowToFront() {
    BrowserWindow.getAllWindows().forEach(window => {
      if (window.isDestroyed()) {
        return;
      }

      window.show();
      window.focus();
      window.setAlwaysOnTop(true, 'screen-saver');
      window.flashFrame(true);

      setTimeout(() => {
        if (!window.isDestroyed()) {
          window.setAlwaysOnTop(false);
        }
      }, 5000);
    });
  }

  _sendIdleCountdown(idleDuration) {
    BrowserWindow.getAllWindows().forEach(window => {
      if (!window.isDestroyed()) {
        window.webContents.send('event:idle-countdown', {
          idleSeconds: idleDuration,
          warningAt: this.idleWarningSeconds,
          closeAt: this.autoCloseInactiveSeconds,
          secondsUntilClose: Math.max(
            0,
            this.autoCloseInactiveSeconds - idleDuration
          )
        });
      }
    });
  }

  _notifyUser(type, data) {
    BrowserWindow.getAllWindows().forEach(window => {
      if (!window.isDestroyed()) {
        window.webContents.send(
          'event:idle-notification',
          {
            type,
            ...data
          }
        );
      }
    });
  }

  async _sendSnapshotToBackend() {
    const timerStatus = timerService.getStatus();
    if (!shouldCreateActivitySnapshot({
      monitoringActive: this.isMonitoring,
      timerStatus,
    })) {
      return;
    }

    const activityPercentage =
      this._getActivityPercentage1Min();

    const localSessionId = timerStatus.sessionId;

    const snapshot = createActivitySnapshot({
      sessionId: localSessionId,
      isOffline: timerService.isOffline,
      activityPercentage,
      activeTime: this.cumulativeActiveTime,
      idleTime: this.cumulativeIdleTime,
      status: this._getCurrentStatus(
        activityPercentage,
        this.systemIdleTime < ACTIVITY_INPUT_WINDOW_SECONDS,
      ),
      systemIdleTime: this.systemIdleTime,
      activeWindow: this.currentActiveWindow,
      activeApp: this.currentActiveApp,
      activeDomain: this.currentActiveDomain,
      trackActiveWindow: this.trackActiveWindow,
    });

    /*
     * Una sesión local todavía no existe en el backend.
     * Guardamos el snapshot hasta sincronizar la sesión.
     */
    if (!snapshot.sessionId) {
      this._enqueueSnapshot(snapshot);

      logger.debug(
        `📴 Snapshot offline guardado. Pendientes: ${this.activityQueue.length}`
      );

      return;
    }

    try {
      await apiClient.post(
        '/activity',
        this._toApiPayload(snapshot)
      );

      if (this.activityQueue.length > 0) {
        await this.processActivityQueue();
      }
    } catch (error) {
      if (isAuthenticationRequiredError(error)) {
        this._enqueueSnapshot(snapshot);
        logger.warn('Actividad conservada hasta iniciar sesión nuevamente.');
        return;
      }
      if (this._isClosedSessionError(error)) {
        // Con el backend actualizado, solo las sesiones cerradas manualmente
        // llegan aquí; las cerradas por timeout aceptan actividad tardía.
        this._discardSessionSnapshots(localSessionId);
        timerService.handleRemoteSessionClosed(
          localSessionId,
          'activity-rejected'
        );

        logger.warn(
          `Actividad detenida: la sesión ${localSessionId} fue cerrada manualmente.`
        );
        return;
      }

      if (!this._isRetryableError(error)) {
        logger.error(
          `Error enviando actividad: ${
            error.response?.data?.errors?.join('; ') ||
            error.response?.data?.message ||
            error.message
          }`
        );

        return;
      }

      this._enqueueSnapshot(snapshot);

      logger.warn(
        `⚠️ Snapshot guardado localmente. Pendientes: ${this.activityQueue.length}`
      );
    }
  }

  async processActivityQueue() {
    if (this.processingQueuePromise) return this.processingQueuePromise;
    this.processingQueuePromise = this._processActivityQueue();
    try {
      return await this.processingQueuePromise;
    } finally {
      this.processingQueuePromise = null;
    }
  }

  updateBrowserDomain({ domain, observedAt } = {}) {
    const normalizedDomain = normalizeActiveDomain(`https://${domain || ''}`);
    if (!normalizedDomain || !this.isMonitoring || !this.trackActiveWindow) {
      return false;
    }

    if (isDomainExcluded(normalizedDomain, this.excludedDomains)) {
      this.browserDomain = null;
      this.browserDomainObservedAt = 0;
      this.currentActiveDomain = null;
      this.currentActiveWindow = null;
      return false;
    }

    const timestamp = Number(observedAt);
    if (!Number.isFinite(timestamp)) return false;

    this.browserDomain = normalizedDomain;
    this.browserDomainObservedAt = timestamp;

    if (SUPPORTED_BROWSER_PATTERN.test(this.currentActiveApp || '')) {
      this.currentActiveDomain = normalizedDomain;
    }

    return true;
  }

  updateNativeBrowserDomain({ domain, observedAt } = {}) {
    const normalizedDomain = normalizeActiveDomain(`https://${domain || ''}`);
    if (!normalizedDomain || !this.isMonitoring || !this.trackActiveWindow) {
      return false;
    }
    if (isDomainExcluded(normalizedDomain, this.excludedDomains)) {
      this.nativeBrowserDomain = null;
      this.nativeBrowserDomainObservedAt = 0;
      this.currentActiveDomain = null;
      this.currentActiveWindow = null;
      return false;
    }

    const timestamp = Number(observedAt);
    if (!Number.isFinite(timestamp)) return false;
    this.nativeBrowserDomain = normalizedDomain;
    this.nativeBrowserDomainObservedAt = timestamp;
    if (SUPPORTED_BROWSER_PATTERN.test(this.currentActiveApp || '')) {
      this.currentActiveDomain = normalizedDomain;
    }
    return true;
  }

  _getFreshBrowserDomain(activeApp) {
    if (!SUPPORTED_BROWSER_PATTERN.test(activeApp || '')) return null;
    if (
      this.nativeBrowserDomain &&
      Date.now() - this.nativeBrowserDomainObservedAt <= BROWSER_DOMAIN_MAX_AGE_MS
    ) {
      return this.nativeBrowserDomain;
    }
    if (
      !this.browserDomain ||
      Date.now() - this.browserDomainObservedAt > BROWSER_DOMAIN_MAX_AGE_MS
    ) {
      return null;
    }
    return this.browserDomain;
  }

  async _processActivityQueue() {
    if (this.activityQueue.length === 0) {
      return;
    }
    if (!apiClient.getToken()) {
      logger.debug('Actividad pendiente en espera de autenticación.');
      return;
    }

    const remaining = [];
    const processingItems = [...this.activityQueue];
    let successCount = 0;

    for (const snapshot of processingItems) {
      if (snapshot.sessionId && !isOfflineItemReady(snapshot)) {
        remaining.push(snapshot);
        continue;
      }

      /*
       * Todavía no se ha sincronizado la sesión local.
       */
      if (!snapshot.sessionId) {
        remaining.push(snapshot);
        continue;
      }

      try {
        
        await apiClient.post(
          '/activity',
          this._toApiPayload(snapshot)
        );
        successCount += 1;
      } catch (error) {
        if (isAuthenticationRequiredError(error)) {
          remaining.push(snapshot);
          logger.warn('Actividad pendiente conservada hasta iniciar sesión nuevamente.');
          continue;
        }
        if (this._isClosedSessionError(error)) {
          timerService.handleRemoteSessionClosed(
            snapshot.sessionId,
            'activity-queue-rejected'
          );
          logger.warn(
            `Snapshot descartado: la sesión ${snapshot.sessionId} ya está cerrada.`
          );
          continue;
        }

        if (this._isRetryableError(error)) {
          remaining.push(scheduleOfflineRetry(snapshot));
          continue;
        }

        logger.error(
          `Snapshot inválido descartado: ${
            error.response?.data?.message ||
            error.message
          }`
        );
      }
    }

    this.activityQueue = reconcileQueueAfterProcessing({
      processingItems,
      currentItems: this.activityQueue,
      remainingItems: remaining,
      getId: item => item?.clientEventId,
    });
    this._saveActivityQueue();

    logger.info(
      `📊 Actividad sincronizada: ${successCount}. Pendientes: ${remaining.length}.`
    );
  }

  replaceSessionId(localSessionId, remoteSessionId) {
    if (!localSessionId || !remoteSessionId) {
      return;
    }

    const linked = linkOfflineSnapshots(
      this.activityQueue,
      localSessionId,
      remoteSessionId,
    );
    this.activityQueue = linked.items;
    const replacements = linked.replacements;

    if (replacements > 0) {
      this._saveActivityQueue();

      logger.info(
        `🔗 ${replacements} snapshots asociados a la sesión ${remoteSessionId}.`
      );
    }
  }

  discardSessionSnapshots(sessionId) {
    this._discardSessionSnapshots(sessionId);
  }

  _toApiPayload(snapshot) {
    return toActivityApiPayload(snapshot, {
      defaultIntervalSeconds: this.reportIntervalSeconds,
    });
  }

  _enqueueSnapshot(snapshot) {
    this.activityQueue.push({
      ...snapshot,
      retryCount: Math.max(0, Number(snapshot.retryCount) || 0),
      nextRetryAt: snapshot.nextRetryAt || null
    });
    this._saveActivityQueue();
  }

  _discardSessionSnapshots(sessionId) {
    if (!sessionId) {
      return;
    }

    const previousLength =
      this.activityQueue.length;

    this.activityQueue =
      this.activityQueue.filter(
        snapshot =>
          String(snapshot.sessionId) !== String(sessionId) &&
          String(snapshot.localSessionId) !== String(sessionId)
      );

    if (
      previousLength !==
      this.activityQueue.length
    ) {
      this._saveActivityQueue();
    }
  }

  _saveActivityQueue() {
    try {
      this.activityQueue = this.activityQueueRepository.save(this.activityQueue, {
        maxOfflineDays: this.maxOfflineDays,
        maxActivitySnapshots: this.maxQueueSize,
      });
      queueMicrotask(() => timerService.notifySyncStatus());
    } catch (error) {
      logger.error(
        `Error guardando cola de actividad: ${error.message}`
      );
    }
  }

  _loadActivityQueue() {
    try {
      const policy = {
        maxOfflineDays: this.maxOfflineDays,
        maxActivitySnapshots: this.maxQueueSize
      };
      this.activityQueue = this.activityQueueRepository.load(policy);

      if (this.activityQueue.length > 0) {
        logger.info(
          `📥 Actividad pendiente cargada: ${this.activityQueue.length} snapshots.`
        );
      }
    } catch (error) {
      logger.error(
        `Error cargando cola de actividad: ${error.message}`
      );

      try {
        const recovered = quarantineLocalPath(this.activityQueuePath);
        if (recovered) logger.warn(`Cola de actividad dañada apartada: ${path.basename(recovered)}`);
      } catch (recoveryError) {
        logger.warn(`No se pudo apartar la cola de actividad dañada: ${recoveryError.message}`);
      }

      this.activityQueue = [];
    }
  }

  _getActivityPercentage1Min() {
    return calculateActivityPercentage(this.activityWindow1Min, 60);
  }

  _getActivityPercentage5Min() {
    return calculateActivityPercentage(this.activityWindow5Min, 300);
  }

  _getCurrentStatus(activityPercentage, hasRecentInput) {
    return getActivityStatus({
      activityPercentage,
      hasRecentInput,
      systemIdleTime: this.systemIdleTime,
      idleThresholdSeconds: this.idleThresholdSeconds,
      lowActivityThreshold: this.lowActivityThreshold,
    });
  }

  _isRetryableError(error) {
    return isRetryableActivityError(error);
  }

  _isClosedSessionError(error) {
    return isClosedSessionActivityError(error);
  }

  getActivityForScreenshot() {
    return this._getActivityPercentage5Min();
  }

  getSnapshot() {
    const activityPercentage1Min =
      this._getActivityPercentage1Min();

    const activityPercentage5Min =
      this._getActivityPercentage5Min();

    return {
      totalDuration:
        this.cumulativeActiveTime +
        this.cumulativeIdleTime,

      activeTime: this.cumulativeActiveTime,
      idleTime: this.cumulativeIdleTime,

      activityPercentage: activityPercentage1Min,
      activityPercentage1Min,
      activityPercentage5Min,

      status: this._getCurrentStatus(
        activityPercentage1Min,
        this.systemIdleTime <
          ACTIVITY_INPUT_WINDOW_SECONDS
      ),

      activeWindow: this.trackActiveWindow
        ? this.currentActiveWindow
        : null,

      activeApp: this.trackActiveWindow
        ? this.currentActiveApp
        : null,

      activeDomain: this.trackActiveWindow
        ? this.currentActiveDomain
        : null,

      systemIdleTime: this.systemIdleTime,
      queueSize: this.activityQueue.length
    };
  }
}

export default new ActivityService();
