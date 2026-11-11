import { describeSessionSyncError } from './sessionSyncErrors.js';
import { SessionEventJournal } from './sessionEventJournal.js';
import { authStore } from './store.js';
import logger from '../utils/logger.js';
import apiClient from './apiClient.js';
import trustedClock from './trustedClock.js';
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
  buildStopBreakPayload,
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
import { confirmRemoteClosure } from './remoteSessionPolicy.js';
import { showTrackingStoppedAlert } from './trackingStoppedAlert.js';
import { getMainWindow } from '../window.js';

class TimerService {
  constructor() {
    this.sessionId = null;
    this.startTime = null;
    this.elapsedSeconds = 0;
    this.tickInterval = null;
    this.statusCheckInterval = null;

    this.isRunning = false;
    this.isPausing = false;
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
    this.activeJournalId = null;
    this.sessionJournal = null;
  }

  initializeSessionJournal() {
    if (this.sessionJournal) return true;
    try {
      const journalPath = path.join(app.getPath('userData'), 'session-events.json');
      const journal = new SessionEventJournal({
        read: () => secureLocalStorage.readJson(journalPath, []),
        write: records => secureLocalStorage.writeJson(journalPath, records),
      });
      if (journal.records.length) journal.recover();
      this.sessionJournal = journal;
      return true;
    } catch (error) {
      this.syncState = 'error';
      this.lastSyncError = 'No se pudo abrir el registro local de sesiones: ' + error.message;
      logger.error(this.lastSyncError);
      return false;
    }
  }

  _sessionOwner() {
    const user = authStore.getUser();
    const userId = user?._id || user?.id;
    const org = user?.organization?._id || user?.organization;
    return userId && org ? String(org) + ':' + String(userId) : null;
  }

  async start(deviceInfo = {}, workSelection = {}) {
    if (this.isRunning) throw new Error('Ya hay una sesión activa.');
    if (!this.sessionJournal && !this.initializeSessionJournal()) throw new Error(this.lastSyncError);
    const ownerId = this._sessionOwner();
    if (!ownerId) throw new Error('Inicia sesión antes de registrar tiempo.');
    const settings = this._getSettings(configService.getConfig());
    if (settings.sessions?.requireProject && !workSelection.projectId) throw new Error('Selecciona un proyecto antes de iniciar.');
    if (apiClient.isConnected === false && settings.sync?.offlineModeEnabled === false) {
      throw new Error('No hay conexión y el modo sin conexión está desactivado.');
    }
    // No network work before accepting the start. A verified server reference is required.
    const session = createOfflineSession(trustedClock.date());
    const deviceData = buildDeviceInfo(deviceInfo, {
      platform: process.platform, osVersion: process.getSystemVersion?.() || 'unknown',
      appVersion: app.getVersion?.() || '1.0.0',
    });
    this.sessionJournal.start({
      localId: session._id, ownerId, startTime: session.startTime,
      deviceInfo: deviceData, ...buildWorkSelection(workSelection),
    });
    this.activeJournalId = session._id;
    this.sessionId = session._id;
    this.startTime = new Date(session.startTime);
    this.elapsedSeconds = 0;
    this.currentConfig = settings;
    this.currentDeviceInfo = deviceData;
    this.workSelection = buildWorkSelection(workSelection);
    this.isPausing = false;
    this.isRunning = true;
    this.isOffline = true; // Awaiting the remote ID; activity stays safely queued.
    configService.setTrackingActive(true);
    try {
      this._startTicker();
      this._startConfiguredServices(settings);
      configService.startSync();
    } catch (error) {
      this._stopServices();
      this.sessionJournal.remove(this.activeJournalId);
      this._resetSessionState();
      throw error;
    }
    this._notifyStatusChange();
    this._notifySyncUpdate();
    this._requestSessionSync();
    return { sessionId: this.sessionId, startTime: this.startTime, elapsedSeconds: 0, status: 'running', isOffline: true };
  }

  async retrySessionSync() {
    if (this.sessionJournal) this.sessionJournal.retryBlocked(this._sessionOwner());
    return this.syncPendingData();
  }

  _requestSessionSync() {
    void this.syncPendingData().catch(error => logger.warn('Sincronización pendiente: ' + error.message));
  }

  async _syncSessionEvents() {
    const ownerId = this._sessionOwner();
    if (!ownerId) return 0;
    if (!this.sessionJournal && !this.initializeSessionJournal()) throw new Error(this.lastSyncError);
    // Negotiate before sending new fields. Older backends already support completed offline intervals.
    let supportsEvents = false;
    try {
      const probe = await apiClient.get('/clock', { timeout: 5000 });
      supportsEvents = Number(probe.data?.capabilities?.sessionEvents) >= 1;
      this.supportsBreakEventTime = Number(probe.data?.capabilities?.breakEventTime) >= 1;
    } catch (error) {
      if (error.response?.status !== 404) throw error;
    }
    // Recover validation latches from the previous desktop without deleting any event.
    for (const item of this.sessionJournal.records.filter(item => item.ownerId === ownerId)) {
      if (!item.endTime && item.localId !== this.activeJournalId) {
        this.sessionJournal.stop(item.localId, item.lastObservedAt || item.startTime, 'system');
      }
      if (item.errorStatus === 400 || /validaci/i.test(item.lastError || '')) {
        this.sessionJournal.update(item.localId, { blocked: false });
      }
    }
    return this.sessionJournal.sync(ownerId, {
      create: async item => {
        if (ownerId !== this._sessionOwner()) throw new Error('La cuenta cambió durante la sincronización');
        if (!supportsEvents && !item.endTime) return null;
        const response = supportsEvents
          ? await apiClient.post('/sessions', {
            localId: item.localId, startTime: item.startTime, deviceInfo: item.deviceInfo,
            ...buildWorkSelection(item),
          })
          : await apiClient.post('/sessions/sync-offline', buildOfflineSessionPayload({
            ...item, duration: calculateElapsedSeconds(item.startTime, Date.parse(item.endTime)),
          }));
        if (ownerId !== this._sessionOwner()) throw new Error('La cuenta cambió durante la sincronización');
        if (!response.data?.success) throw new Error(response.data?.message || 'Inicio no confirmado');
        return response.data.data;
      },
      linked: async item => {
        if (ownerId !== this._sessionOwner()) throw new Error('La cuenta cambió durante la sincronización');
        activityService.replaceSessionId(item.localId, item.remoteId);
        await screenshotService.replaceSessionId(item.localId, item.remoteId);
        if (this.activeJournalId === item.localId && this.isRunning) {
          this.sessionId = item.remoteId;
          this.isOffline = false;
          if (!this.statusCheckInterval) this.statusCheckInterval = setInterval(() => this._checkSessionStatus(), 30000);
          this._notifyStatusChange();
        }
      },
      stop: async item => {
        if (ownerId !== this._sessionOwner()) throw new Error('La cuenta cambió durante la sincronización');
        const response = await apiClient.post('/sessions/' + item.remoteId + '/stop', {
          ...(supportsEvents ? { endTime: item.endTime } : {}), reason: item.reason || 'manual', notes: item.notes || null,
        });
        if (!response.data?.success) throw new Error(response.data?.message || 'Cierre no confirmado');
        return response.data.data;
      },
      closed: async (item, session) => {
        if (this.activeJournalId === item.localId && this.isRunning) {
          this._stopServices();
          this._resetSessionState();
          this._notifyUI(IPC_CHANNELS.EVENT_SESSION_CLOSED, {
            sessionId: item.localId, duration: session.totalDuration,
            durationSeconds: session.totalDuration, reason: session.closedReason || 'backend',
            message: 'El servidor confirmó que esta sesión ya estaba cerrada (' + (session.closedReason || 'cierre remoto') + ').',
          });
        }
        const expected = item.endTime ? calculateElapsedSeconds(item.startTime, Date.parse(item.endTime)) : null;
        this._notifyUI('event:session-synced', {
          sessionId: item.localId, duration: session.totalDuration,
          adjusted: expected !== null && Number(session.totalDuration) !== expected,
          reason: session.closedReason || 'manual',
        });
      },
      rejected: async (item, error) => {
        if ([403, 409].includes(error.response?.status) && item && this.activeJournalId === item.localId && this.isRunning) {
          this._stopServices();
          this._resetSessionState();
          this._notifyUI(IPC_CHANNELS.EVENT_SESSION_CLOSED, {
            sessionId: item.localId, duration: 0, reason: 'rejected', queuedForSync: true,
            message: 'El servidor rechazó el registro. Se conserva para revisión: ' + (error.response?.data?.message || error.message),
          });
        }
      },
    });
  }

  async startBreak(typeId, notes = '') {
    if (!this.isRunning || this.isOffline || !this.sessionId) throw new Error('Necesitas una sesión online activa.');
    if (this.currentBreakId) throw new Error('Ya existe una pausa activa.');
    const trackingId = this.activeJournalId || this.sessionId;
    const startTime = this.startTime;
    const pausedAt = trustedClock.date();
    this.elapsedSeconds = calculateElapsedSeconds(startTime, pausedAt);
    this.isPausing = true;
    this._stopTicker();
    let activeBreak;
    try {
      const response = await apiClient.post('/breaks/start', {
        typeId, sessionId: this.sessionId, notes,
        ...(this.supportsBreakEventTime ? { endTime: pausedAt.toISOString() } : {}),
      });
      if (!response.data?.success || !response.data.data?._id) throw new Error(response.data?.message || 'No se pudo iniciar la pausa.');
      activeBreak = response.data.data;
    } catch (error) {
      this.isPausing = false;
      this._startTicker();
      throw error;
    }
    const confirmed = Number(activeBreak.closedSession?.durationSeconds);
    const duration = Number.isFinite(confirmed) && confirmed >= 0
      ? Math.floor(confirmed)
      : calculateElapsedSeconds(startTime, Date.parse(activeBreak.startTime || pausedAt.toISOString()));
    if (this.activeJournalId) this.sessionJournal.remove(this.activeJournalId);
    this.activeJournalId = null;
    this._stopServices();
    this.sessionId = null;
    this.startTime = null;
    this.elapsedSeconds = 0;
    this.isRunning = false;
    this.isOffline = false;
    this.currentConfig = null;
    this.currentDeviceInfo = null;
    this.isPausing = false;
    this.currentBreakId = activeBreak?._id || null;
    this.currentBreakEndsAt = activeBreak?.expiresAt || null;
    this._scheduleBreakExpiration(activeBreak);
    this._notifyStatusChange();
    this._notifyUI(IPC_CHANNELS.EVENT_SESSION_CLOSED, {
      sessionId: trackingId, duration, durationSeconds: duration, durationFormatted: formatDuration(duration),
      reason: 'break',
      message: `Seguimiento detenido por la pausa ${activeBreak?.type?.name || ''}.`,
    });
    return { ...activeBreak, serverNow: trustedClock.date().toISOString() };
  }

  async restoreActiveSession(session) {
    if (this.isRunning || !session?._id || !session?.startTime) return false;
    const journalEntry = this.sessionJournal?.find(String(session._id)) || (session.localId && this.sessionJournal?.find(session.localId));
    if (journalEntry?.endTime || journalEntry?.blocked) return false;

    const localDevice = buildDeviceInfo({}, {
      platform: process.platform,
      osVersion: process.getSystemVersion?.() || 'unknown',
      appVersion: app.getVersion?.() || '1.0.0',
    });
    const remoteHostname = String(session.deviceInfo?.hostname || '').trim().toLowerCase();
    const localHostname = String(localDevice.hostname || '').trim().toLowerCase();

    // Nunca adoptar una sesión que pertenece claramente a otro equipo.
    if (remoteHostname && localHostname && remoteHostname !== localHostname) return false;

    const previousStartTime = new Date(session.startTime);
    if (Number.isNaN(previousStartTime.getTime())) return false;

    const response = await apiClient.post('/sessions', {
      resumeSessionId: String(session._id),
      deviceInfo: localDevice,
      ...buildWorkSelection({
        projectId: session.project?._id || session.project || null,
        taskId: session.task?._id || session.task || null,
      }),
    });
    const resumedSession = response.data?.data;
    if (!response.data?.success || !resumedSession?._id || !resumedSession?.startTime) {
      throw new Error(response.data?.message || 'No se pudo reanudar la sesión anterior.');
    }

    const startTime = new Date(resumedSession.startTime);
    if (Number.isNaN(startTime.getTime())) return false;

    const config = await this._loadConfig();
    const settings = this._getSettings(config);

    this._cleanupIntervals();
    this.currentConfig = settings;
    this.currentDeviceInfo = localDevice;
    if (!this.sessionJournal) throw new Error('No se pudo abrir el registro local de sesiones.');
    const local = createOfflineSession(startTime);
    this.sessionJournal.start({ localId: local._id, remoteId: String(resumedSession._id),
      ownerId: this._sessionOwner(), startTime: startTime.toISOString(), deviceInfo: localDevice });
    this.activeJournalId = local._id;
    this.sessionId = String(resumedSession._id);
    this.startTime = startTime;
    this.elapsedSeconds = calculateElapsedSeconds(startTime, trustedClock.now());
    this.isPausing = false;
    this.isRunning = true;
    this.isOffline = false;
    this.workSelection = buildWorkSelection({
      projectId: resumedSession.project?._id || resumedSession.project || null,
      taskId: resumedSession.task?._id || resumedSession.task || null,
    });

    configService.setTrackingActive(true);
    this._startTicker();
    this.statusCheckInterval = setInterval(() => this._checkSessionStatus(), 30 * 1000);
    this._startConfiguredServices(settings);
    configService.startSync();
    this._notifyStatusChange();

    logger.info(
      `Sesión reanudada después del reinicio sin contabilizar el tiempo apagado: ${this.sessionId}`,
    );
    return true;
  }

  async stopBreak() {
    if (!this.currentBreakId) throw new Error('No hay una pausa activa.');
    const breakId = this.currentBreakId;
    const endedAt = trustedClock.date().toISOString();
    let result;
    try {
      // En línea, el backend es la fuente de tiempo. No enviamos la hora de
      // Windows porque puede estar atrasada o haber sido modificada.
      const response = await apiClient.post(`/breaks/${breakId}/stop`, {});
      result = response.data.data;
    } catch (error) {
      if (!isNetworkError(error)) throw error;
      this._queueBreakStop({ breakId, endedAt });
      result = { _id: breakId, endTime: endedAt, status: 'ended', pendingSync: true };
      logger.info(`Pausa finalizada sin conexión y guardada para sincronización: ${breakId}`);
    }
    this._clearBreakExpiration();
    this.currentBreakId = null;
    this.currentBreakEndsAt = null;
    this._notifyStatusChange();
    return result;
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
    const delay = Math.max(0, new Date(activeBreak.expiresAt).getTime() - trustedClock.now());
    this.breakExpiryTimer = setTimeout(() => void this._handleBreakExpired(activeBreak), delay);
    this.breakExpiryTimer.unref?.();
  }

  async _handleBreakExpired(activeBreak) {
    if (String(this.currentBreakId) !== String(activeBreak?._id)) return;

    const endedAtCandidate = new Date(activeBreak.expiresAt);
    const endedAt = Number.isNaN(endedAtCandidate.getTime())
      ? trustedClock.date().toISOString()
      : endedAtCandidate.toISOString();

    // Liberamos primero el estado local para que la UI nunca dependa de la
    // latencia o disponibilidad del backend al vencer una pausa.
    this._clearBreakExpiration();
    this.currentBreakId = null;
    this.currentBreakEndsAt = null;
    this._notifyStatusChange();
    this._notifyUI(IPC_CHANNELS.EVENT_BREAK_ENDED, {
      id: activeBreak._id,
      reason: 'expired',
      endedAt,
    });

    try {
      await apiClient.post(`/breaks/${activeBreak._id}/stop`, { endedAt });
    } catch (error) {
      if (isNetworkError(error)) {
        this._queueBreakStop({ breakId: activeBreak._id, endedAt });
        logger.info(`Cierre de pausa vencida guardado para sincronización: ${activeBreak._id}`);
      } else if (error.response?.status !== 404) {
        logger.warn(`No se pudo confirmar el fin de la pausa: ${error.message}`);
      }
    }

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
    const endTime = trustedClock.date();
    this.elapsedSeconds = calculateElapsedSeconds(startTime, endTime);
    const duration = this.elapsedSeconds;
    const activitySnapshot = activityService.getSnapshot();

    if (this.activeJournalId) {
      const journalId = this.activeJournalId;
      this.sessionJournal.stop(journalId, endTime.toISOString(), normalizedReason, cleanNotes, activitySnapshot);
      this._stopServices();
      this._resetSessionState();
      const result = {
        sessionId: journalId, duration, durationSeconds: duration,
        durationFormatted: formatDuration(duration), status: 'stopped', queuedForSync: true,
      };
      this._notifyUI(IPC_CHANNELS.EVENT_SESSION_CLOSED, {
        ...result, reason: normalizedReason,
        message: normalizedReason === 'inactivity' ? 'Sesión cerrada por inactividad.' : 'Sesión detenida.',
      });
      this._notifySyncUpdate();
      this._requestSessionSync();
      return result;
    }

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
          activity: activitySnapshot,
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
        message: normalizedReason === 'inactivity'
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
    if (this.syncPendingPromise) {
      this.syncAgain = true;
      return this.syncPendingPromise;
    }
    this.syncPendingPromise = (async () => {
      do {
        this.syncAgain = false;
        await this._syncPendingData();
      } while (this.syncAgain);
    })();
    try { return await this.syncPendingPromise; }
    finally { this.syncPendingPromise = null; }
  }

  async _syncPendingData() {
    if (!apiClient.getToken()) {
      return;
    }

    this.syncState = 'syncing';
    this.lastSyncError = null;
    this._notifySyncUpdate();
    try {
      if (!trustedClock.isReady()) {
        await apiClient.get('/health', { timeout: 5000 });
        trustedClock.now();
      }
      const eventCount = await this._syncSessionEvents();
      const promotedOfflineSession = await this._promoteActiveOfflineSession();
      const synchronizedSessions = await this._syncPendingSessions();
      await activityService.processActivityQueue();
      await screenshotService.processQueue();
      if (eventCount > 0 || promotedOfflineSession || synchronizedSessions > 0) {
        this._notifyUI(IPC_CHANNELS.EVENT_TIMER_UPDATE, {
          ...buildTimerUpdate({
            isRunning: this.isRunning,
            currentBreakId: this.currentBreakId,
            isOffline: false,
            elapsedSeconds: this.elapsedSeconds,
            sessionId: this.sessionId,
            trackingId: this.activeJournalId || this.sessionId,
          }),
          refreshTodayTotal: true,
        });
      }
      this.syncState = 'idle';
      this.lastSyncAt = trustedClock.date().toISOString();
    } catch (error) {
      this.syncState = 'error';
      this.lastSyncError = describeSessionSyncError(error);
      throw error;
    } finally {
      this._notifySyncUpdate();
    }
  }

  async _syncPendingSessions() {
    this._prunePendingSessions();
    this._savePendingSessions();
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
      if (!isPendingSessionReady(pending, trustedClock.now())) {
        remaining.push(pending);
        continue;
      }

      try {
        if (pending.type === 'stop-break') {
          await retryRequest(
            async () => {
              const response = await apiClient.post(
                `/breaks/${pending.breakId}/stop`,
                buildStopBreakPayload(pending),
              );
              if (!response.data?.success) {
                throw new Error(response.data?.message || 'No se pudo sincronizar el cierre de la pausa');
              }
              return response;
            },
            { attempts: retryAttempts, isRetryable: isNetworkError },
          );
          successCount += 1;
          logger.info(`Cierre de pausa pendiente sincronizado: ${pending.breakId}`);
          continue;
        }

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
          remaining.push(schedulePendingSessionRetry(pending, error, trustedClock.now()));
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
    if (this.activeJournalId) return false;
    if (!this.isRunning || !this.isOffline || !String(this.sessionId || '').startsWith('offline-')) {
      return false;
    }

    const localSessionId = this.sessionId;
    const offlineStartTime = this.startTime || trustedClock.date();
    const transitionTime = trustedClock.date();
    const offlineDuration = Math.max(
      0,
      Math.min(
        this.elapsedSeconds,
        Math.floor((transitionTime.getTime() - offlineStartTime.getTime()) / 1000),
      ),
    );
    const activitySnapshot = activityService.getSnapshot();

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
        activity: activitySnapshot,
      }));
    }

    this.sessionId = onlineSession._id;
    this.isOffline = false;
    this.startTime = new Date(onlineSession.startTime || transitionTime);
    this.elapsedSeconds = Math.max(
      0,
      Math.floor((trustedClock.now() - this.startTime.getTime()) / 1000),
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
      if (this.isRunning && !this.isPausing && this.startTime) {
        this.elapsedSeconds = calculateElapsedSeconds(this.startTime, trustedClock.now());
      }
      const activitySnapshot = activityService.getSnapshot();
      this._stopServices();
      if (this.isRunning && this.sessionId) {
        const endTime = trustedClock.date();

        if (this.activeJournalId) {
          this.sessionJournal.stop(this.activeJournalId, endTime.toISOString(), 'system', null, activitySnapshot);
        } else if (this.isOffline || String(this.sessionId).startsWith('offline-')) {
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
              activity: activitySnapshot,
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
    this.isPausing = false;
    this.activeJournalId = null;
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
      createdAt: trustedClock.date().toISOString(),
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
        createdAt: trustedClock.date().toISOString(),
        ...operation
      });
    }

    this._savePendingSessions();
  }

  _queueBreakStop(operation) {
    const alreadyExists = this.pendingSessions.some(
      pending => pending.type === 'stop-break' && pending.breakId === operation.breakId
    );
    if (!alreadyExists) {
      this.pendingSessions.push({
        type: 'stop-break',
        retryCount: 0,
        nextRetryAt: null,
        createdAt: trustedClock.date().toISOString(),
        ...operation,
      });
    }
    this._savePendingSessions();
  }

  _savePendingSessions() {
    try {
      this.pendingSessions = this.pendingSessionRepository.save(this.pendingSessions, trustedClock.isReady() ? trustedClock.now() : null);
      this._notifySyncUpdate();
    } catch (error) {
      logger.error(
        `Error guardando sesiones pendientes: ${error.message}`
      );
    }
  }

  _loadPendingSessions() {
    try {
      this.pendingSessions = this.pendingSessionRepository.load(trustedClock.isReady() ? trustedClock.now() : null);

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
    if (!trustedClock.isReady()) return;
    const policy = this.getOfflinePolicy();
    this.pendingSessions = pruneOfflineQueue(this.pendingSessions, {
      now: trustedClock.now(),
      maxOfflineDays: policy.maxOfflineDays,
      maxItems: policy.maxPendingSessions,
      getTimestamp: item => item.createdAt || item.endTime || item.startTime
    });
  }

  getSyncStatus() {
    const eventCount = this.sessionJournal?.pending(this._sessionOwner()).length || 0;
    const pendingActivity = activityService.activityQueue?.length || 0;
    const pendingScreenshots = screenshotService.pendingQueue?.length || 0;
    return {
      state: this.syncState,
      pendingSessions: this.pendingSessions.length + eventCount,
      pendingActivity,
      pendingScreenshots,
      pendingTotal: this.pendingSessions.length + eventCount + pendingActivity + pendingScreenshots,
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
      this.elapsedSeconds = calculateElapsedSeconds(this.startTime, trustedClock.now());
    }
    return buildTimerStatus({
      isRunning: this.isRunning,
      currentBreakId: this.currentBreakId,
      isOffline: this.isOffline,
      sessionId: this.sessionId,
              trackingId: this.activeJournalId || this.sessionId,
      startTime: this.startTime,
      elapsedSeconds: this.elapsedSeconds,
      pendingOperations: this.getSyncStatus().pendingSessions,
      sync: this.getSyncStatus(),
      config: configService.getStatus?.() || null
    });
  }

  async handleRemoteSessionClosed(sessionId, source = 'backend', knownSession) {
    if (this.isPausing) return false;
    let result;
    try {
      result = await confirmRemoteClosure({
        sessionId,
        session: knownSession,
        getSession: async id => {
          const response = await apiClient.get(`/sessions/${id}`);
          return response.data?.success ? response.data.data : null;
        },
      });
    } catch (error) {
      logger.warn(`No se pudo confirmar el cierre; se conserva la actividad pendiente: ${error.message}`);
      return false;
    }
    // A timeout is a server-side boundary, not an instruction to stop tracking.
    // Activity after that boundary is reconciled by the backend on synchronization.
    if (result.state !== 'closed') return false;
    if (
      !this.isRunning ||
      !this.sessionId ||
      String(this.sessionId) !== String(sessionId)
    ) {
      return true;
    }

    const duration = this.elapsedSeconds;

    logger.warn(
      `La sesión ${sessionId} fue cerrada externamente (${source}).`
    );

    if (this.activeJournalId) this.sessionJournal.remove(this.activeJournalId);
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

    try {
      showTrackingStoppedAlert({
        window: getMainWindow(), Notification,
        message: 'La jornada fue cerrada desde el servidor. El registro de tiempo se detuvo. Revisa la app antes de continuar trabajando.',
      });
    } catch (error) {
      logger.warn(`No se pudo mostrar la alerta de cierre: ${error.message}`);
    }

    return true;
  }

  _startTicker() {
    this._stopTicker();

    this.tickInterval = setInterval(() => {
      if (!this.isRunning || this.isPausing) return;
      this.elapsedSeconds = calculateElapsedSeconds(this.startTime, trustedClock.now());
      if (this.activeJournalId) {
        const record = this.sessionJournal.find(this.activeJournalId);
        if (record && trustedClock.now() - Date.parse(record.lastObservedAt) >= 5000) {
          try { this.sessionJournal.checkpoint(this.activeJournalId, trustedClock.date().toISOString()); }
          catch (error) { logger.error('No se pudo guardar el avance de la sesión: ' + error.message); }
        }
      }

      BrowserWindow.getAllWindows().forEach(window => {
        if (!window.isDestroyed()) {
          window.webContents.send(
            IPC_CHANNELS.EVENT_TIMER_UPDATE,
            buildTimerUpdate({
              isRunning: this.isRunning,
              currentBreakId: this.currentBreakId,
              isOffline: this.isOffline,
              elapsedSeconds: this.elapsedSeconds,
              sessionId: this.sessionId,
              trackingId: this.activeJournalId || this.sessionId
            })
          );
        }
      });
    }, 100);

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
    if (this.isPausing) return;
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

      await this.handleRemoteSessionClosed(
        this.sessionId,
        'status-check',
        session,
      );
    } catch (error) {
      logger.debug(
        `No se pudo verificar el estado de la sesión: ${error.message}`
      );
    }
  }
}

export default new TimerService();
