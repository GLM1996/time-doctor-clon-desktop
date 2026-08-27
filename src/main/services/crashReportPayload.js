import { sanitizeCrashText } from './crashSanitizer.js';

const PROCESS_TYPES = new Set(['main', 'renderer', 'gpu']);
const SEVERITIES = new Set(['warning', 'error', 'fatal']);

export function normalizeCrashReportInput(payload, forcedProcessType) {
  const source = isPlainObject(payload) ? payload : {};
  const processType = forcedProcessType || source.processType;

  return {
    processType: PROCESS_TYPES.has(processType) ? processType : 'unknown',
    eventType: sanitizeCrashText(scalarText(source.eventType), 80) || 'unknown',
    message: sanitizeCrashText(scalarText(source.message), 500) || 'Unknown desktop error',
    stack: sanitizeCrashText(scalarText(source.stack), 8000) || null,
    severity: SEVERITIES.has(source.severity) ? source.severity : 'error',
  };
}

function scalarText(value) {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
