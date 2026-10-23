import { io } from 'socket.io-client';
import apiClient from './apiClient.js';
import timerService from './timerService.js';
import screenshotService from './screenshotService.js';
import logger from '../utils/logger.js';

class CaptureRealtimeService {
  start() {
    if (process.platform !== 'win32' || this.interval) return;
    this.sync = () => {
      const token = apiClient.getToken();
      if (!token) { this.socket?.disconnect(); this.token = null; return; }
      if (!this.socket) {
        const url = apiClient.client.defaults.baseURL.replace(/\/api\/?$/, '');
        this.socket = io(url, { path: '/realtime', autoConnect: false, transports: ['websocket', 'polling'], reconnection: true });
        this.socket.on('connect', () => { this.registration = null; this.sync(); });
        this.socket.on('disconnect', reason => {
          this.registration = null;
          if (reason === 'io server disconnect') this.refresh();
        });
        this.socket.on('connect_error', error => {
          if (['UNAUTHORIZED', 'SESSION_REVOKED'].includes(error.message)) this.refresh();
        });
        this.socket.on('screenshot:request', async (request, ack) => {
          if (typeof ack !== 'function') return;
          if (this.seen?.has(request?.requestId)) return ack({ success: false, message: 'Solicitud duplicada' });
          this.seen ??= new Map();
          const now = Date.now();
          for (const [id, expiry] of this.seen) if (expiry <= now) this.seen.delete(id);
          this.seen.set(request?.requestId, now + 60000);
          try { await screenshotService.captureOnDemand(request); ack({ success: true }); }
          catch (error) { ack({ success: false, message: error.message }); }
        });
      }
      if (this.token !== token) {
        this.socket.disconnect();
        this.socket.auth = { token };
        this.token = token;
        this.registration = null;
      }
      if (!this.socket.connected && !this.refreshing) this.socket.connect();
      const status = timerService.getStatus();
      const details = { sessionId: status.isRunning && !status.isPaused ? status.sessionId : null,
        platform: process.platform, enabled: screenshotService.isCapturing };
      const registration = JSON.stringify(details);
      if (this.socket.connected && registration !== this.registration) {
        this.socket.emit('screenshot:register', details);
        this.registration = registration;
      }
    };
    this.interval = setInterval(this.sync, 2000);
    this.sync();
  }

  async refresh() {
    if (this.refreshing || !apiClient.getToken()) return;
    this.refreshing = true;
    try { await apiClient.refreshAccessToken(); }
    catch (error) { logger.debug(`Canal de captura sin autenticar: ${error.message}`); }
    finally { this.refreshing = false; }
  }

  destroy() {
    clearInterval(this.interval);
    this.interval = null;
    this.socket?.disconnect();
    this.socket = null;
  }
}
export default new CaptureRealtimeService();
