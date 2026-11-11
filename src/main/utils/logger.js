import log from 'electron-log';
import { app } from 'electron';
import { sanitizeCrashText } from '../services/crashSanitizer.js';
import trustedClock from '../services/trustedClock.js';

// Configurar logger
log.transports.file.level = 'info';
log.transports.file.maxSize = 5 * 1024 * 1024;
log.transports.console.level = app.isPackaged ? 'warn' : 'debug';

// Formato personalizado
const serverLogFormat = ({ level, data }) => [
  `[${trustedClock.isReady() ? trustedClock.date().toISOString() : 'hora-servidor-pendiente'}] [${level}]`,
  ...data,
];
log.transports.file.format = serverLogFormat;
log.transports.console.format = serverLogFormat;

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
