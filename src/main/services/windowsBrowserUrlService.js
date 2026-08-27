import { spawn } from 'node:child_process';
import path from 'node:path';
import readline from 'node:readline';
import { app } from 'electron';
import logger from '../utils/logger.js';
import { normalizeNativeBrowserDomainMessage } from './windowsBrowserUrlPolicy.js';

class WindowsBrowserUrlService {
  constructor() {
    this.child = null;
    this.restartTimer = null;
    this.shouldRun = false;
    this.onDomain = null;
  }

  start({ onDomain } = {}) {
    if (process.platform !== 'win32') return;
    this.shouldRun = true;
    this.onDomain = onDomain;
    if (this.child) return;

    const scriptPath = app.isPackaged
      ? path.join(process.resourcesPath, 'native', 'windows-browser-url.ps1')
      : path.join(app.getAppPath(), 'native', 'windows-browser-url.ps1');
    const powershell = path.join(
      process.env.SystemRoot || 'C:\\Windows',
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe',
    );

    this.child = spawn(
      powershell,
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        scriptPath,
        '-ParentPid',
        String(process.pid),
      ],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
    );

    const output = readline.createInterface({ input: this.child.stdout });
    output.on('line', (line) => {
      try {
        const message = normalizeNativeBrowserDomainMessage(JSON.parse(line));
        if (message) this.onDomain?.(message);
      } catch {
        // Ignoramos cualquier salida que no cumpla el contrato mínimo.
      }
    });
    this.child.stderr.on('data', (chunk) => {
      const message = String(chunk || '').trim();
      if (message) logger.debug(`Colector nativo del navegador: ${message}`);
    });
    this.child.on('error', (error) => {
      logger.warn(`No se pudo iniciar la captura nativa del navegador: ${error.message}`);
    });
    this.child.on('exit', () => {
      output.close();
      this.child = null;
      if (this.shouldRun) {
        this.restartTimer = setTimeout(() => this.start({ onDomain: this.onDomain }), 5000);
        this.restartTimer.unref?.();
      }
    });
  }

  stop() {
    this.shouldRun = false;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = null;
    this.child?.kill();
    this.child = null;
  }
}

export default new WindowsBrowserUrlService();
