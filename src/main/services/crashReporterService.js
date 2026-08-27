import { app, ipcMain } from 'electron';
import apiClient from './apiClient.js';
import { normalizeCrashReportInput } from './crashReportPayload.js';
import { createResilientElectronStore } from './resilientElectronStore.js';
let queueStore;
function store() {
  if (!queueStore) queueStore = createResilientElectronStore({ name: 'crash-reports', schema: { queue: { type: 'array', default: [] } } });
  return queueStore;
}
class CrashReporterService {
  flushing = false;
  started = false;
  start() {
    if (this.started) return;
    this.started = true;
    ipcMain.on('app:renderer-error', (_event, payload) => this.capture(payload, 'renderer'));
  }
  capture(payload, forcedProcessType) {
    const report = {
      appVersion: app.getVersion(),
      platform: process.platform,
      architecture: process.arch,
      ...normalizeCrashReportInput(payload, forcedProcessType),
    };
    const queue = store().get('queue', []);
    store().set('queue', [...queue.slice(-49), report]);
    this.flush().catch(() => {});
  }
  async flush() {
    if (this.flushing || !apiClient.getToken()) return;
    this.flushing = true;
    try {
      const pending = store().get('queue', []);
      let sent = 0;
      for (const report of pending) { try { await apiClient.client.post('/desktop-crashes', report, { timeout: 10_000 }); sent += 1; } catch { break; } }
      if (sent) store().set('queue', pending.slice(sent));
    } finally { this.flushing = false; }
  }
}
export default new CrashReporterService();
