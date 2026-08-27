import { BrowserWindow } from 'electron';

import { IPC_CHANNELS } from '../ipc/channels.js';
import logger from '../utils/logger.js';
import apiClient from './apiClient.js';
import { createSingleFlightRunner } from './singleFlightRunner.js';
import { shouldApplyProbeResult } from './connectivityProbePolicy.js';

const ONLINE_CHECK_INTERVAL = 30000;
const OFFLINE_CHECK_INTERVAL = 10000;

class ConnectionService {
  constructor() {
    this.connected = null;
    this.timer = null;
    this.running = false;
    this.checkInProgress = null;
    this.unsubscribeApi = null;
    this.onReconnect = null;
    this.onHealthy = null;
    this.runPendingSync = createSingleFlightRunner();
    this.signalRevision = 0;
  }

  start({ onReconnect, onHealthy } = {}) {
    if (this.running) return;
    this.running = true;
    this.onReconnect =
      typeof onReconnect === 'function'
        ? onReconnect
        : null;
    this.onHealthy = typeof onHealthy === 'function' ? onHealthy : null;
    this.unsubscribeApi = apiClient.onConnectionChange(
      (connected) => {
        if (connected) {
          this.signalRevision += 1;
          this._setConnected(true, 'api');
          return;
        }

        /*
         * Un timeout aislado (por ejemplo, una captura grande) no demuestra
         * que todo el backend esté caído. Confirmamos con el health check.
         */
        this.checkNow();
      },
    );
    this.checkNow();
  }

  async checkNow() {
    if (!this.running) return false;
    if (this.checkInProgress) return this.checkInProgress;

    this._clearTimer();
    this.checkInProgress = this._performCheck();

    try {
      return await this.checkInProgress;
    } finally {
      this.checkInProgress = null;
      this._scheduleNextCheck();
    }
  }

  async _performCheck() {
    const startRevision = this.signalRevision;
    const connected = await apiClient.healthCheck();
    if (!shouldApplyProbeResult(startRevision, this.signalRevision)) {
      logger.debug('Se ignorÃ³ un health check anterior a una seÃ±al de conexiÃ³n mÃ¡s reciente.');
      return this.connected === true;
    }
    this.signalRevision += 1;
    this._setConnected(connected, 'health');
    if (connected && this.onHealthy) {
      this.runPendingSync(this.onHealthy).catch((error) => {
        logger.warn(`No se pudieron procesar datos pendientes durante el health check: ${error.message}`);
      });
    }
    return connected;
  }

  handleNetworkHint(online) {
    if (online === false) {
      this.signalRevision += 1;
      this._setConnected(false, 'renderer');
      this._scheduleNextCheck();
      return;
    }

    this.checkNow();
  }

  getStatus() {
    return this.connected;
  }

  _setConnected(connected, source) {
    const normalized = Boolean(connected);
    if (this.connected === normalized) return;

    const previous = this.connected;
    this.connected = normalized;
    logger.info(
      `Estado de conexión: ${normalized ? 'conectado' : 'sin conexión'} (${source}).`,
    );

    BrowserWindow.getAllWindows().forEach((window) => {
      if (!window.isDestroyed()) {
        window.webContents.send(
          IPC_CHANNELS.EVENT_CONNECTION_STATUS,
          { connected: normalized, source },
        );
      }
    });

    if (normalized && previous === false && this.onReconnect) {
      this.runPendingSync(this.onReconnect).catch((error) => {
        logger.warn(
          `No se pudieron sincronizar todos los datos pendientes: ${error.message}`,
        );
      });
    }

    this._scheduleNextCheck();
  }

  _scheduleNextCheck() {
    if (!this.running || this.checkInProgress) return;
    this._clearTimer();
    this.timer = setTimeout(
      () => this.checkNow(),
      this.connected === false
        ? OFFLINE_CHECK_INTERVAL
        : ONLINE_CHECK_INTERVAL,
    );
  }

  _clearTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  destroy() {
    this.running = false;
    this._clearTimer();
    this.unsubscribeApi?.();
    this.unsubscribeApi = null;
    this.onReconnect = null;
    this.onHealthy = null;
  }
}

export default new ConnectionService();
