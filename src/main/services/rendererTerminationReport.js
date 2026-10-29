export function rendererTerminationReport(details, context = {}) {
  const explanations = {
    killed: 'La interfaz fue terminada por una orden externa al proceso. Electron no identifica quién la envió.',
    oom: 'La interfaz se cerró por falta de memoria.',
    crashed: 'El proceso de la interfaz sufrió un fallo.',
    'memory-eviction': 'La interfaz fue terminada preventivamente para evitar falta de memoria.',
    'integrity-failure': 'Windows bloqueó el proceso por una comprobación de integridad.',
    'launch-failed': 'El proceso de la interfaz no pudo iniciarse.',
    'abnormal-exit': 'El proceso de la interfaz terminó con un código de error.',
    'clean-exit': 'El proceso de la interfaz terminó sin código de error.',
  };
  const code = Number.isInteger(details.exitCode) ? details.exitCode : null;
  const exitCode = code === null ? 'no disponible' : `${code} (0x${(code >>> 0).toString(16).toUpperCase().padStart(8, '0')})`;
  return {
    eventType: 'render-process-gone',
    message: `${explanations[details.reason] || 'El proceso de la interfaz terminó.'} Motivo: ${details.reason}. Código de salida: ${exitCode}.`,
    processType: 'renderer',
    severity: details.reason === 'clean-exit' || context.quitting ? 'warning' : 'fatal',
    stack: [
      `Motivo: ${details.reason}; código de salida: ${exitCode}`,
      `Hora UTC: ${new Date().toISOString()}`,
      `Segundos desde apertura de ventana: ${context.windowAgeSeconds ?? 'no disponible'}`,
      `Cierre de aplicación en curso: ${Boolean(context.quitting)}`,
      `Ventana visible: ${Boolean(context.visible)}`,
      `Electron: ${context.electronVersion || 'no disponible'}; Chromium: ${context.chromeVersion || 'no disponible'}`,
      `Sistema: ${context.osVersion || 'no disponible'}`,
    ].join('\n'),
  };
}
