import logger from '../utils/logger.js';
import apiClient from './apiClient.js';
import { BrowserWindow, Notification, app } from 'electron';
import { IPC_CHANNELS } from '../ipc/channels.js';
import screenshotService from './screenshotService.js';
import activityService from './activityService.js';
import configService from './configService.js';
import path from 'path';
import secureLocalStorage from './secureLocalStorage.js';
import PendingSessionRepository from './pendingSessionRepository.js';
import { normalizeMonitoringSettings } from './monitoringSettings.js';
import {
  buildDeviceInfo,
  buildPendingExistingStop,
  buildPendingOfflineSession,
  buildWorkSelection,
  createOfflineSession,
  normalizeStopInput,
} from './sessionPayloads.js';
import { pruneOfflineQueue, reconcileQueueAfterProcessing } from './offlineQueuePolicy.js';
import {
  buildOfflineSessionPayload,
  buildStopSessionPayload,
  classifyPendingSessionError,
  getRemoteSessionId,
  getPendingSessionKey,
  getSessionRetryAttempts,
  holdPendingSession,
  isPendingSessionReady,
  schedulePendingSessionRetry,
} from './pendingSessionPolicy.js';
import {
  calculateElapsedSeconds,
  formatDuration,
  isAlreadyClosedSessionError,
  isNetworkError,
} from './timerServiceUtils.js';
import { retryRequest } from './retryRequest.js';
import { buildTimerStatus, buildTimerUpdate } from './timerStatus.js';
import { quarantineLocalPath } from './localDataRecovery.js';

class TimerService {
  constructor() {
    this.sessionId = null;
    this.startTime = null;
    this.elapsedSeconds = 0;
    this.tickInterval = null;
    this.statusCheckInterval = null;

    this.isRunning = false;
    this.isOffline = false;
    this.currentBreakId = null;
    this.currentBreakEndsAt = null;
    this.breakExpiryTimer = null;

    this.currentConfig = null;
    this.currentDeviceInfo = null;

    this.pendingSessions = [];
    this.syncPendingPromise = null;
    this.syncState = 'idle';
    this.lastSyncAt = null;
    this.lastSyncError = null;
    this.statusListeners = new Set();
    this.pendingSessionsPath = path.join(
      app.getPath('userData'),
      'pending-sessions.json'
    );
    this.pendingSessionRepository = new PendingSessionRepository({
      filePath: this.pendingSessionsPath,
      storage: secureLocalStorage,
    });

    this._loadPendingSessions();
  }

  async start(deviceInfo = {}, workSelection = {}) {
    if (this.isRunning) {
      throw new Error('Ya hay una sesión activa.');
    }

    try {
      logger.info('🟢 Iniciando sesión de trabajo...');

      const config = await this._loadConfig();
      const settings = this._getSettings(config);

      this.currentConfig = settings;

      const deviceData = buildDeviceInfo(deviceInfo, {
        platform: process.platform,
        osVersion: process.getSystemVersion?.() || 'unknown',
        appVersion: app.getVersion?.() || '1.0.0',
      });

      this.currentDeviceInfo = deviceData;

      let session;
      let isOffline = false;

      try {
        const response = await apiClient.post('/sessions', {
          deviceInfo: deviceData,
          ...buildWorkSelection(workSelection),
        });

        if (!response.data?.success) {
          throw new Error(
            response.data?.message || 'Error al iniciar la sesión'
          );
        }

        session = response.data.data;

        logger.info('✅ Sesión creada en el backend');

        if (this.pendingSessions.length > 0) {
          this._syncPendingSessions().catch(error => {
            logger.warn(
              `No se pudieron sincronizar operaciones pendientes: ${error.message}`
            );
          });
        }
      } catch (error) {
        const networkFailure = isNetworkError(error);
        const offlineEnabled = settings.sync?.offlineModeEnabled !== false;

        if (!networkFailure) {
          throw new Error(
            error.response?.data?.message || error.message
          );
        }

        if (!offlineEnabled) {
          throw new Error(
            'No se pudo conectar con el servidor y el modo offline está desactivado.'
          );
        }

        logger.warn('⚠️ Sin conexión. Creando sesión local offline.');

        session = createOfflineSession();

        isOffline = true;
      }

      this.sessionId = session._id;
      this.startTime = new Date(session.startTime);
      this.elapsedSeconds = calculateElapsedSeconds(this.startTime);
      this.isRunning = true;
      this.isOffline = isOffline;
      configService.setTrackingActive(true);
      this.workSelection = buildWorkSelection(workSelection);
      this._notifyStatusChange();

      this._startTicker();

      if (!this.isOffline) {
        this.statusCheckInterval = setInterval(() => {
          this._checkSessionStatus();
        }, 30 * 1000);
      }

      this._startConfiguredServices(settings);

      configService.startSync();

      logger.info(
        `✅ Sesión iniciada: ${this.sessionId} ${
          isOffline ? '(OFFLINE)' : '(ONLINE)'
        }`
      );

      return {
        sessionId: this.sessionId,
        startTime: this.startTime,
        status: 'running',
        isOffline
      };
    } catch (error) {
      logger.error(`❌ Error iniciando sesión: ${error.message}`);

      this._cleanupIntervals();

      this.isRunning = false;
      this.isOffline = false;
      this.sessionId = null;
      this.startTime = null;
      this.elapsedSeconds = 0;
      this._notifyStatusChange();

      throw error;
    }
  }

  async startBreak(typeId, notes = '') {
    if (!this.isRunning || this.isOffline || !this.sessionId) throw new Error('Necesitas una sesión online activa.');
    if (this.currentBreakId) throw new Error('Ya existe una pausa activa.');
    const response = await apiClient.post('/breaks/start', { typeId, sessionId: this.sessionId, notes });
    const activeBreak = response.data?.data;
    this._stopServices();
    this.sessionId = null;
    this.startTime = null;
    this.elapsedSeconds = 0;
    this.isRunning = false;
    this.isOffline = false;
    this.currentConfig = null;
    this.currentDeviceInfo = null;
    this.currentBreakId = activeBreak?._id || null;
    this.currentBreakEndsAt = activeBreak?.expiresAt || null;
    this._scheduleBreakExpiration(activeBreak);
    this._notifyStatusChange();
    this._notifyUI(IPC_CHANNELS.EVENT_SESSION_CLOSED, {
      reason: 'break',
      message: `Seguimiento detenido por la pausa ${activeBreak?.type?.name || ''}.`,
    });
    return activeBreak;
  }

  async restoreActiveSession(session) {
    if (this.isRunning || !session?._id || !session?.startTime) return false;

    const localDevice = buildDeviceInfo({}, {
      platform: process.platform,
      osVersion: process.getSystemVersion?.() || 'unknown',
      appVersion: app.getVersion?.() || '1.0.0',
    });
    const remoteHostname = String(session.deviceInfo?.hostname || '').trim().toLowerCase();
    const localHostname = String(localDevice.hostname || '').trim().toLowerCase();

    // Nunca adoptar una sesión que pertenece claramente a otro equipo.
    if (remoteHostname && localHostname && remoteHostname !== localHostname) return false;

    const startTime = new Date(session.startTime);
    if (Number.isNaN(startTime.getTime())) return false;

    const config = await this._loadConfig();
    const settings = this._getSettings(config);

    this._cleanupIntervals();
    this.currentConfig = settings;
    this.currentDeviceInfo = localDevice;
    this.sessionId = String(session._id);
    this.startTime = startTime;
    this.elapsedSeconds = calculateElapsedSeconds(startTime);
    this.isRunning = true;
    this.isOffline = false;
    this.workSelection = buildWorkSelection({
      projectId: session.project?._id || session.project || null,
      taskId: session.task?._id || session.task || null,
    });

    configService.setTrackingActive(true);
    this._startTicker();
    this.statusCheckInterval = setInterval(() => this._checkSessionStatus(), 30 * 1000);
    this._startConfiguredServices(settings);
    configService.startSync();
    this._notifyStatusChange();

    logger.info(`Sesión activa restaurada después del reinicio: ${this.sessionId}`);
    return true;
  }

  async stopBreak() {
    if (!this.currentBreakId) throw new Error('No hay una pausa activa.');
    const response = await apiClient.post(`/breaks/${this.currentBreakId}/stop`);
    this._clearBreakExpiration();
    this.currentBreakId = null;
    this.currentBreakEndsAt = null;
    this._notifyStatusChange();
    return response.data.data;
  }

  restoreBreak(activeBreak) {
    this.currentBreakId = activeBreak?._id || null;
    this.currentBreakEndsAt = activeBreak?.expiresAt || null;
    this._scheduleBreakExpiration(activeBreak);
    this._notifyStatusChange();
  }

  _clearBreakExpiration() {
    if (this.breakExpiryTimer) clearTimeout(this.breakExpiryTimer);
    this.breakExpiryTimer = null;
  }

  _scheduleBreakExpiration(activeBreak) {
    this._clearBreakExpiration();
    if (!activeBreak?._id || !activeBreak?.expiresAt) return;
    const delay = Math.max(0, new Date(activeBreak.expiresAt).getTime() - Date.now());
    this.breakExpiryTimer = setTimeout(() => void this._handleBreakExpired(activeBreak), delay);
    this.breakExpiryTimer.unref?.();
  }

  async _handleBreakExpired(activeBreak) {
    if (String(this.currentBreakId) !== String(activeBreak?._id)) return;
    try {
      await apiClient.post(`/breaks/${activeBreak._id}/stop`);
    } catch (error) {
      if (error.response?.status !== 404) logger.warn(`No se pudo confirmar el fin de la pausa: ${error.message}`);
    }
    this._clearBreakExpiration();
    this.currentBreakId = null;
    this.currentBreakEndsAt = null;
    this._notifyStatusChange();
    const window = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed());
    if (window) {
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
      window.setAlwaysOnTop(true);
      setTimeout(() => { if (!window.isDestroyed()) window.setAlwaysOnTop(false); }, 1200).unref?.();
    }
    if (Notification.isSupported()) {
      new Notification({ title: 'Pausa finalizada', body: 'Tu pausa terminó. Pulsa Play para continuar trabajando.' }).show();
    }
    this._notifyUI(IPC_CHANNELS.EVENT_BREAK_ENDED, { id: activeBreak._id, reason: 'expired' });
  }

  async stop(reason = 'manual', notes = '') {
    if (!this.isRunning || !this.sessionId) {
      this._notifyUI('event:session-closed', {
        reason: 'already_stopped',
        message: 'No hay una sesión activa'
      });

      throw new Error('No hay una sesión activa.');
    }

    const stopInput = normalizeStopInput(reason, notes);
    const normalizedReason = stopInput.reason;

    const settings =
      this.currentConfig || this._getSettings(configService.getConfig());

    const cleanNotes = stopInput.notes;

    if (
      normalizedReason === 'manual' &&
      settings.sessions?.requireNotesOnStop === true &&
      !cleanNotes
    ) {
      throw new Error('Debes agregar una nota para detener la jornada.');
    }

    const sessionId = this.sessionId;
    const wasOffline = this.isOffline;
    const startTime = this.startTime;
    const endTime = new Date();
    this.elapsedSeconds = calculateElapsedSeconds(startTime, endTime);
    const duration = this.elapsedSeconds;

    try {
      logger.info(`🔴 Deteniendo sesión... Motivo: ${reason}`);

      this._stopServices();

      if (this.currentBreakId && !wasOffline) {
        try { await this.stopBreak(false); } catch (error) { logger.warn(`No se pudo cerrar la pausa: ${error.message}`); }
      }

      let queuedForSync = false;
      let confirmedDuration = duration;

      if (wasOffline) {
        this._queueOfflineSession(buildPendingOfflineSession({
          sessionId,
          startTime,
          endTime,
          duration,
          reason: normalizedReason,
          notes: cleanNotes,
          deviceInfo: this.currentDeviceInfo,
          workSelection: this.workSelection,
        }));

        queuedForSync = true;

        logger.info(
          '📴 Sesión offline guardada para sincronización posterior.'
        );
      } else {
        try {
          const response = await apiClient.post(
            `/sessions/${sessionId}/stop`,
            {
              reason: normalizedReason,
              notes: cleanNotes
            }
          );

          if (!response.data?.success) {
            throw new Error(
              response.data?.message || 'Error al detener la sesión'
            );
          }

          const serverDuration = Number(response.data?.data?.totalDuration);
          if (Number.isFinite(serverDuration) && serverDuration >= 0) {
            confirmedDuration = Math.floor(serverDuration);
          }
        } catch (error) {
          const offlineEnabled =
            settings.sync?.offlineModeEnabled !== false;

          if (!isNetworkError(error) || !offlineEnabled) {
            throw error;
          }

          this._queueExistingSessionStop(buildPendingExistingStop({
            sessionId,
            endTime,
            duration,
            reason: normalizedReason,
            notes: cleanNotes,
          }));

          queuedForSync = true;

          logger.warn(
            '⚠️ No se pudo guardar el cierre en el servidor. Quedó pendiente.'
          );
        }
      }

      this._resetSessionState();

      this._notifyUI('event:session-closed', {
        sessionId,
        reason: normalizedReason,
        message: queuedForSync
          ? 'La jornada fue guardada localmente y se sincronizará al recuperar la conexión.'
          : normalizedReason === 'inactivity'
            ? 'La jornada fue cerrada por inactividad.'
            : 'La jornada fue guardada correctamente.',
        duration: confirmedDuration,
        durationSeconds: confirmedDuration,
        durationFormatted: formatDuration(confirmedDuration),
        wasOffline,
        queuedForSync
      });

      logger.info(
        `✅ Sesión ${sessionId} detenida. Duración: ${duration}s`
      );

      return {
        sessionId,
        duration: confirmedDuration,
        durationSeconds: confirmedDuration,
        durationFormatted: formatDuration(confirmedDuration),
        status: 'stopped',
        wasOffline,
        queuedForSync
      };
    } catch (error) {
      logger.error(`❌ Error deteniendo sesión: ${error.message}`);

      /*
       * Si el backend respondió con un error real, por ejemplo 400 o 401,
       * no borramos el estado local de la sesión silenciosamente.
       *
       * Los servicios ya se detuvieron para evitar seguir registrando
       * actividad mientras el cierre no se pudo completar.
       */
      this._notifyUI('event:session-stop-error', {
        reason: 'error',
        message: error.message
      });

      throw error;
    }
  }

  async syncPendingData() {
    if (this.syncPendingPromise) return this.syncPendingPromise;
    this.syncPendingPromise = this._syncPendingData();
    try {
      return await this.syncPendingPromise;
    } finally {
      this.syncPendingPromise = null;
    }
  }

  async _syncPendingData() {
    if (!apiClient.getToken()) {
      return;
    }

    this.syncState = 'syncing';
    this.lastSyncError = null;
    this._notifySyncUpdate();
    try {
      const promotedOfflineSession = await this._promoteActiveOfflineSession();
      const synchronizedSessions = await this._syncPendingSessions();
      await activityService.processActivityQueue();
      await screenshotService.processQueue();
      if (promotedOfflineSession || synchronizedSessions > 0) {
        this._notifyUI(IPC_CHANNELS.EVENT_TIMER_UPDATE, {
          ...buildTimerUpdate({
            isRunning: this.isRunning,
            currentBreakId: this.currentBreakId,
            isOffline: false,
            elapsedSeconds: this.elapsedSeconds,
            sessionId: this.sessionId,
          }),
          refreshTodayTotal: true,
        });
      }
      this.syncState = 'idle';
      this.lastSyncAt = new Date().toISOString();
    } catch (error) {
      this.syncState = 'error';
      this.lastSyncError = error.message;
      throw error;
    } finally {
      this._notifySyncUpdate();
    }
  }

  async _syncPendingSessions() {
    if (this.pendingSessions.length === 0) {
      return 0;
    }

    const settings =
      this.currentConfig || this._getSettings(configService.getConfig());

    const retryAttempts = getSessionRetryAttempts(settings);

    logger.info(
      `📤 Sincronizando ${this.pendingSessions.length} operaciones pendientes...`
    );

    const remaining = [];
    const processingItems = [...this.pendingSessions];
    let successCount = 0;

    for (const pending of processingItems) {
      if (!isPendingSessionReady(pending)) {
        remaining.push(pending);
        continue;
      }

      try {
        if (pending.type === 'stop-existing') {
          try {
            await retryRequest(
              async () => {
              const response = await apiClient.post(
                `/sessions/${pending.sessionId}/stop`,
                buildStopSessionPayload(pending)
              );

              if (!response.data?.success) {
                throw new Error(
                  response.data?.message ||
                    'No se pudo sincronizar el cierre'
                );
              }

                return response;
              },
              { attempts: retryAttempts, isRetryable: isNetworkError }
            );
          } catch (error) {
            if (!isAlreadyClosedSessionError(error)) {
              throw error;
            }

            logger.info(
              `Cierre pendiente ya aplicado anteriormente: ${pending.sessionId}`
            );
          }

          successCount += 1;

          logger.info(
            `✅ Cierre pendiente sincronizado: ${pending.sessionId}`
          );

          continue;
        }

        const response = await retryRequest(
          async () => {
            const result = await apiClient.post(
              '/sessions/sync-offline',
              buildOfflineSessionPayload(pending)
            );

            if (!result.data?.success) {
              throw new Error(
                result.data?.message ||
                  'No se pudo sincronizar la sesión offline'
              );
            }

            return result;
          },
          { attempts: retryAttempts, isRetryable: isNetworkError }
        );

        const remoteSessionId = getRemoteSessionId(response);

        if (remoteSessionId && pending.localId) {
          activityService.replaceSessionId(
            pending.localId,
            remoteSessionId
          );
          await screenshotService.replaceSessionId(
            pending.localId,
            remoteSessionId
          );
        }

        successCount += 1;

        logger.info(
          `✅ Sesión offline sincronizada: ${pending.localId}`
        );
      } catch (error) {
        const action = classifyPendingSessionError(error, pending);

        if (action === 'retry') {
          remaining.push(schedulePendingSessionRetry(pending, error));
        } else if (action === 'hold') {
          remaining.push(holdPendingSession(pending, error));
        }

        const identifier = pending.localId || pending.sessionId;
        if (action === 'discard') {
          if (pending.localId) {
            activityService.discardSessionSnapshots(pending.localId);
            await screenshotService.discardSessionItems(pending.localId);
          }
          logger.error(
            `Operación pendiente descartada por error permanente (${identifier}): ${error.message}`
          );
        } else {
          logger.warn(
            `No se pudo sincronizar ${
            pending.localId || pending.sessionId
            }: ${error.message}. Acción: ${action}`
          );
        }
      }
    }

    this.pendingSessions = reconcileQueueAfterProcessing({
      processingItems,
      currentItems: this.pendingSessions,
      remainingItems: remaining,
      getId: getPendingSessionKey,
    });
    this._prunePendingSessions();
    this._savePendingSessions();

    if (successCount > 0) {
      await activityService.processActivityQueue();
    }

    logger.info(
      `📊 Operaciones sincronizadas: ${successCount}. Pendientes: ${this.pendingSessions.length}.`
    );

    return successCount;
  }

  _startConfiguredServices(settings) {
    const config = normalizeMonitoringSettings(settings);

    if (config.screenshots.enabled) {
      screenshotService.setOfflinePolicy(config.offline);
      screenshotService.setQuality(config.screenshots.quality);
      screenshotService.setCaptureLimits(config.screenshots);
      screenshotService.setBlurSensitiveData(config.screenshots.blurSensitiveData);
      screenshotService.start(config.screenshots.intervalMinutes);
    }

    if (config.activity.enabled) {
      const { enabled: _enabled, ...activityOptions } = config.activity;
      activityService.start({
        ...activityOptions,
        maxOfflineDays: config.offline.maxOfflineDays,
      });
    }
  }

  _stopServices() {
    configService.setTrackingActive(false);
    this._cleanupIntervals();

    activityService.stop();
    screenshotService.stop();
    configService.stopSync();
  }

  async _promoteActiveOfflineSession() {
    if (!this.isRunning || !this.isOffline || !String(this.sessionId || '').startsWith('offline-')) {
      return false;
    }

    const localSessionId = this.sessionId;
    const offlineStartTime = this.startTime || new Date();
    const transitionTime = new Date();
    const offlineDuration = Math.max(
      0,
      Math.min(
        this.elapsedSeconds,
        Math.floor((transitionTime.getTime() - offlineStartTime.getTime()) / 1000),
      ),
    );

    const response = await apiClient.post('/sessions', {
      deviceInfo: this.currentDeviceInfo || {},
      ...buildWorkSelection(this.workSelection),
    });
    const onlineSession = response.data?.data;
    if (!response.data?.success || !onlineSession?._id) {
      throw new Error(response.data?.message || 'No se pudo continuar la sesión en línea');
    }

    const alreadyQueued = this.pendingSessions.some((pending) => pending.localId === localSessionId);
    if (!alreadyQueued) {
      this._queueOfflineSession(buildPendingOfflineSession({
        sessionId: localSessionId,
        startTime: offlineStartTime,
        endTime: transitionTime,
        duration: offlineDuration,
        reason: 'system',
        notes: 'Tramo offline finalizado automáticamente al recuperar conexión',
        deviceInfo: this.currentDeviceInfo,
        workSelection: this.workSelection,
      }));
    }

    this.sessionId = onlineSession._id;
    this.isOffline = false;
    this.startTime = new Date(onlineSession.startTime || transitionTime);
    this.elapsedSeconds = Math.max(
      0,
      Math.floor((Date.now() - this.startTime.getTime()) / 1000),
    );
    if (this.statusCheckInterval) clearInterval(this.statusCheckInterval);
    this.statusCheckInterval = setInterval(() => this._checkSessionStatus(), 30 * 1000);
    this._notifyStatusChange();

    logger.info(`Sesión offline promovida automáticamente: ${localSessionId} -> ${this.sessionId}`);
    return true;
  }

  // Limpieza local idempotente: nunca hace red ni bloquea la salida de Electron.
  prepareForShutdown() {
    try {
      if (this.isRunning && this.startTime) {
        this.elapsedSeconds = calculateElapsedSeconds(this.startTime);
      }
      this._stopServices();
      if (this.isRunning && this.sessionId) {
        const endTime = new Date();

        if (this.isOffline || String(this.sessionId).startsWith('offline-')) {
          const alreadyQueued = this.pendingSessions.some(
            pending => pending.localId === this.sessionId,
          );
          if (!alreadyQueued) {
            this._queueOfflineSession(buildPendingOfflineSession({
              sessionId: this.sessionId,
              startTime: this.startTime || endTime,
              endTime,
              duration: this.elapsedSeconds,
              reason: 'system',
              notes: null,
              deviceInfo: this.currentDeviceInfo,
              workSelection: this.workSelection,
            }));
          }
        } else {
          this._queueExistingSessionStop(buildPendingExistingStop({
            sessionId: this.sessionId,
            endTime,
            duration: this.elapsedSeconds,
            reason: 'system',
            notes: null,
          }));
        }
      }
      if (this.isRunning || this.sessionId) this._resetSessionState();
    } catch (error) {
      logger.warn(`Limpieza local de cierre incompleta: ${error.message}`);
    }
  }

  _cleanupIntervals() {
    this._stopTicker();

    if (this.statusCheckInterval) {
      clearInterval(this.statusCheckInterval);
      this.statusCheckInterval = null;
    }
  }

  _resetSessionState() {
    this._cleanupIntervals();

    this.sessionId = null;
    this.startTime = null;
    this.elapsedSeconds = 0;
    this.isRunning = false;
    this.isOffline = false;
    this.currentBreakId = null;
    this.currentConfig = null;
    this.currentDeviceInfo = null;
    this._notifyStatusChange();
  }

  onStatusChange(listener) {
    if (typeof listener !== 'function') return () => {};

    this.statusListeners.add(listener);

    return () => {
      this.statusListeners.delete(listener);
    };
  }

  _notifyStatusChange() {
    const status = this.getStatus();

    this.statusListeners.forEach(listener => {
      try {
        listener(status);
      } catch (error) {
        logger.warn(
          `Un listener de estado del temporizador falló: ${error.message}`
        );
      }
    });
  }

  _queueOfflineSession(session) {
    this.pendingSessions.push({
      type: 'offline-session',
      retryCount: 0,
      nextRetryAt: null,
      createdAt: new Date().toISOString(),
      ...session
    });

    this._prunePendingSessions();
    this._savePendingSessions();
  }

  _queueExistingSessionStop(operation) {
    const alreadyExists = this.pendingSessions.some(
      pending =>
        pending.type === 'stop-existing' &&
        pending.sessionId === operation.sessionId
    );

    if (!alreadyExists) {
      this.pendingSessions.push({
        type: 'stop-existing',
        retryCount: 0,
        nextRetryAt: null,
        createdAt: new Date().toISOString(),
        ...operation
      });
    }

    this._savePendingSessions();
  }

  _savePendingSessions() {
    try {
      this.pendingSessions = this.pendingSessionRepository.save(this.pendingSessions);
      this._notifySyncUpdate();
    } catch (error) {
      logger.error(
        `Error guardando sesiones pendientes: ${error.message}`
      );
    }
  }

  _loadPendingSessions() {
    try {
      this.pendingSessions = this.pendingSessionRepository.load();

      this._prunePendingSessions();

      if (this.pendingSessions.length > 0) {
        logger.info(
          `📥 Operaciones pendientes cargadas: ${this.pendingSessions.length}`
        );
      }
    } catch (error) {
      logger.error(
        `Error cargando sesiones pendientes: ${error.message}`
      );

      try {
        const recovered = quarantineLocalPath(this.pendingSessionsPath);
        if (recovered) logger.warn(`Sesiones pendientes dañadas apartadas: ${path.basename(recovered)}`);
      } catch (recoveryError) {
        logger.warn(`No se pudo apartar sesiones pendientes dañadas: ${recoveryError.message}`);
      }

      this.pendingSessions = [];
    }
  }

  async _loadConfig() {
    try {
      return await configService.syncConfig();
    } catch (error) {
      logger.warn(
        `No se pudo actualizar la configuración: ${error.message}`
      );

      return configService.getConfig();
    }
  }

  _getSettings(config) {
    if (!config) {
      return {};
    }

    return config.settings || config.data?.settings || config;
  }

  getOfflinePolicy() {
    const settings = this.currentConfig || this._getSettings(configService.getConfig());
    return {
      maxOfflineDays: Math.min(30, Math.max(1, Number(settings.sync?.maxOfflineDays) || 7)),
      maxPendingSessions: 1000,
      maxActivitySnapshots: 10000,
      maxPendingScreenshots: 500
    };
  }

  _prunePendingSessions() {
    const policy = this.getOfflinePolicy();
    this.pendingSessions = pruneOfflineQueue(this.pendingSessions, {
      maxOfflineDays: policy.maxOfflineDays,
      maxItems: policy.maxPendingSessions,
      getTimestamp: item => item.createdAt || item.endTime || item.startTime
    });
  }

  getSyncStatus() {
    const pendingActivity = activityService.activityQueue?.length || 0;
    const pendingScreenshots = screenshotService.pendingQueue?.length || 0;
    return {
      state: this.syncState,
      pendingSessions: this.pendingSessions.length,
      pendingActivity,
      pendingScreenshots,
      pendingTotal: this.pendingSessions.length + pendingActivity + pendingScreenshots,
      lastSyncAt: this.lastSyncAt,
      lastError: this.lastSyncError
    };
  }

  _notifySyncUpdate() {
    this._notifyUI(IPC_CHANNELS.EVENT_SYNC_UPDATE, this.getSyncStatus());
  }

  notifySyncStatus() {
    this._notifySyncUpdate();
  }

  _notifyUI(channel, data) {
    BrowserWindow.getAllWindows().forEach(window => {
      if (!window.isDestroyed()) {
        window.webContents.send(channel, data);
      }
    });
  }

  getStatus() {
    if (this.isRunning && this.startTime) {
      this.elapsedSeconds = calculateElapsedSeconds(this.startTime);
    }
    return buildTimerStatus({
      isRunning: this.isRunning,
      currentBreakId: this.currentBreakId,
      isOffline: this.isOffline,
      sessionId: this.sessionId,
      startTime: this.startTime,
      elapsedSeconds: this.elapsedSeconds,
      pendingOperations: this.pendingSessions.length,
      sync: this.getSyncStatus(),
      config: configService.getStatus?.() || null
    });
  }

  handleRemoteSessionClosed(sessionId, source = 'backend') {
    if (
      !this.isRunning ||
      !this.sessionId ||
      String(this.sessionId) !== String(sessionId)
    ) {
      return false;
    }

    const duration = this.elapsedSeconds;

    logger.warn(
      `La sesión ${sessionId} fue cerrada externamente (${source}).`
    );

    this._stopServices();
    this._resetSessionState();

    this._notifyUI(IPC_CHANNELS.EVENT_SESSION_CLOSED, {
      reason: 'backend',
      source,
      message:
        'La jornada fue cerrada desde el servidor. El monitoreo local se detuvo.',
      duration,
      durationFormatted: formatDuration(duration)
    });

    return true;
  }

  _startTicker() {
    this._stopTicker();

    this.tickInterval = setInterval(() => {
      this.elapsedSeconds = calculateElapsedSeconds(this.startTime);

      BrowserWindow.getAllWindows().forEach(window => {
        if (!window.isDestroyed()) {
          window.webContents.send(
            IPC_CHANNELS.EVENT_TIMER_UPDATE,
            buildTimerUpdate({
              isRunning: this.isRunning,
              currentBreakId: this.currentBreakId,
              isOffline: this.isOffline,
              elapsedSeconds: this.elapsedSeconds,
              sessionId: this.sessionId
            })
          );
        }
      });
    }, 1000);

    logger.debug('⏱️ Ticker iniciado');
  }

  _stopTicker() {
    if (!this.tickInterval) {
      return;
    }

    clearInterval(this.tickInterval);
    this.tickInterval = null;

    logger.debug('⏱️ Ticker detenido');
  }

  async _checkSessionStatus() {
    if (
      !this.isRunning ||
      !this.sessionId ||
      this.isOffline ||
      this.sessionId.startsWith('offline-')
    ) {
      return;
    }

    try {
      const response = await apiClient.get(
        `/sessions/${this.sessionId}`
      );

      if (!response.data?.success) {
        return;
      }

      const session = response.data.data;

      if (
        session.status !== 'ended' &&
        session.status !== 'stopped'
      ) {
        return;
      }

      logger.warn('⚠️ La sesión fue cerrada desde el backend.');

      this.handleRemoteSessionClosed(
        this.sessionId,
        'status-check'
      );
    } catch (error) {
      logger.debug(
        `No se pudo verificar el estado de la sesión: ${error.message}`
      );
    }
  }
}

export default new TimerService();
