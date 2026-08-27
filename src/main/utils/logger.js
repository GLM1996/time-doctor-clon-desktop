import log from 'electron-log';
import { app } from 'electron';
import { sanitizeCrashText } from '../services/crashSanitizer.js';

// Configurar logger
log.transports.file.level = 'info';
log.transports.file.maxSize = 5 * 1024 * 1024;
log.transports.console.level = app.isPackaged ? 'warn' : 'debug';

// Formato personalizado
log.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}] [{level}] {text}';

function sanitizeLogArgument(value) {
  if (typeof value === 'string') return sanitizeCrashText(value, 4000);
  if (value instanceof Error) return sanitizeCrashText(value.stack || value.message, 8000);
  if (value === null || ['number', 'boolean', 'undefined'].includes(typeof value)) return value;
  try {
    return sanitizeCrashText(JSON.stringify(value), 4000);
  } catch {
    return '[UNSERIALIZABLE]';
  }
}

function write(method, args) {
  log[method](...args.map(sanitizeLogArgument));
}

const logger = {
  info: (...args) => write('info', args),
  warn: (...args) => write('warn', args),
  error: (...args) => write('error', args),
  debug: (...args) => write('debug', args),
};

export default logger;
