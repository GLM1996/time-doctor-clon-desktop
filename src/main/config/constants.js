import path from 'path';
import { app } from 'electron';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const APP_CONFIG = {
  NAME: 'LogYourTime',

  VERSION: app?.getVersion?.() || '1.0.0',

  // Rutas
  USER_DATA_PATH:
    app?.getPath?.('userData') ||
    path.join(__dirname, '../../../data'),

  LOGS_PATH:
    app?.getPath?.('logs') ||
    path.join(__dirname, '../../../logs'),

  // Intervalos por defecto
  // Se pueden sobrescribir con la configuración del backend
  DEFAULT_SCREENSHOT_INTERVAL: 5 * 60 * 1000, // 5 minutos
  DEFAULT_SYNC_INTERVAL: 5 * 60 * 1000, // 5 minutos
  DEFAULT_ACTIVITY_SAMPLE: 60 * 1000, // 1 minuto

  // Límites
  MAX_OFFLINE_DAYS: 7,
  MAX_RETRY_ATTEMPTS: 3,


  // URLs
  API_URL:
    import.meta.env.VITE_API_URL ||
    'https://backend.logyourtime.com/api',
};

export default APP_CONFIG;
