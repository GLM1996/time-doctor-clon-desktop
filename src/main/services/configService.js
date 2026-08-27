import logger from '../utils/logger.js';
import apiClient from './apiClient.js';
import screenshotService from './screenshotService.js';
import activityService from './activityService.js';
import path from 'path';
import { app } from 'electron';
import { quarantineConfigFile, readConfigFile, writeConfigFile } from './configFileRepository.js';
import { extractDesktopSettings, normalizeSyncIntervalMinutes } from './desktopConfigResponse.js';
import { getScreenshotConfigTransition } from './screenshotConfigTransition.js';
import { normalizeMonitoringSettings } from './monitoringSettings.js';

class ConfigService {
    constructor() {
        this.config = null;
        this.syncInterval = null;
        this.syncInProgress = null;
        this.trackingActive = false;
        this.configFilePath = path.join(app.getPath('userData'), 'last-config.json');

        // Cargar última config conocida (fallback offline)
        this._loadLocalConfig();
    }

    // ==========================================
    // INICIAR SINCRONIZACIÓN PERIÓDICA
    // ==========================================

    startSync() {
        this.stopSync();
        // Sincronizar inmediatamente al iniciar
        this.syncConfig().catch(err => {
            logger.warn(`No se pudo sincronizar config al iniciar: ${err.message}`);
        });

        // Usar el intervalo de sync de la propia config (default: 5 min)
        const syncMinutes = normalizeSyncIntervalMinutes(this.config?.sync?.syncIntervalMinutes);

        this.syncInterval = setInterval(() => {
            this.syncConfig().catch(err => {
                logger.warn(`Error en sync periódico de config: ${err.message}`);
            });
        }, syncMinutes * 60 * 1000);

        logger.info(`🔄 Sincronización de configuración iniciada (cada ${syncMinutes} min)`);
    }

    stopSync() {
        if (this.syncInterval) {
            clearInterval(this.syncInterval);
            this.syncInterval = null;
        }
        logger.info('🔄 Sincronización de configuración detenida');
    }

    // ==========================================
    // SINCRONIZAR CON EL BACKEND
    // ==========================================

    async syncConfig() {
        if (this.syncInProgress) return this.syncInProgress;
        this.syncInProgress = this._syncConfig();
        try {
            return await this.syncInProgress;
        } finally {
            this.syncInProgress = null;
        }
    }

    async _syncConfig() {
        try {
            // 👇 Tu endpoint ya existe: getDesktopConfig(userId)
            const response = await apiClient.get('/config/desktop', { timeout: 10000 });
           
            const newConfig = extractDesktopSettings(response.data);
            const oldConfig = this.config;
            const previousSyncMinutes = normalizeSyncIntervalMinutes(oldConfig?.sync?.syncIntervalMinutes);
            const nextSyncMinutes = normalizeSyncIntervalMinutes(newConfig?.sync?.syncIntervalMinutes);
            const normalizedConfig = normalizeMonitoringSettings(newConfig);
            screenshotService.setQuality(normalizedConfig.screenshots.quality);
            screenshotService.setCaptureLimits(normalizedConfig.screenshots);
            screenshotService.setBlurSensitiveData(normalizedConfig.screenshots.blurSensitiveData);
            const screenshotTransition = getScreenshotConfigTransition({
                oldConfig,
                newConfig,
                isCapturing: screenshotService.isCapturing,
                trackingActive: this.trackingActive,
            });
            this._applyScreenshotTransition(screenshotTransition);
            this._applyActivityConfig(newConfig);

            // Guardar nueva config
            this.config = newConfig;
            this._saveLocalConfig(newConfig);
            if (this.syncInterval && previousSyncMinutes !== nextSyncMinutes) {
                this._restartSyncInterval(nextSyncMinutes);
            }

            logger.info(`✅ Configuración sincronizada (versión: ${newConfig.version || 'N/A'})`);
            return newConfig;

        } catch (error) {
            logger.warn(`⚠️ No se pudo sincronizar config: ${error.message}. Usando última config conocida.`);

            if (!this.config) {
                this.config = this._getDefaults();
                logger.info('⚙️ Usando configuración por defecto');
            }

            return this.config;
        }
    }

    _applyScreenshotTransition({ action, intervalMinutes }) {
        if (action === 'stop') {
            screenshotService.stop();
            return;
        }
        if (action === 'restart') {
            if (screenshotService.isCapturing) screenshotService.stop();
            screenshotService.start(intervalMinutes);
            logger.info(`Capturas configuradas en un único paso: cada ${intervalMinutes} min.`);
        }
    }

    setTrackingActive(active) {
        this.trackingActive = active === true;
    }

    _restartSyncInterval(intervalMinutes) {
        if (this.syncInterval) clearInterval(this.syncInterval);
        const safeMinutes = normalizeSyncIntervalMinutes(intervalMinutes);
        this.syncInterval = setInterval(() => {
            this.syncConfig().catch(error => {
                logger.warn(`Error en sincronización periódica: ${error.message}`);
            });
        }, safeMinutes * 60 * 1000);
        logger.info(`Intervalo de configuración actualizado: cada ${safeMinutes} min.`);
    }

    _applyActivityConfig(config) {
        const normalized = normalizeMonitoringSettings(config);
        if (!this.trackingActive || !normalized.activity.enabled) {
            activityService.stop();
            return;
        }

        const { enabled: _enabled, ...options } = normalized.activity;
        if (activityService.isMonitoring) {
            activityService.reconfigure({
                ...options,
                maxOfflineDays: normalized.offline.maxOfflineDays,
            });
            return;
        }
        activityService.start({
            ...options,
            maxOfflineDays: normalized.offline.maxOfflineDays,
        });
    }

    // ==========================================
    // PERSISTENCIA LOCAL (Fallback offline)
    // ==========================================

    _saveLocalConfig(config) {
        try {
            writeConfigFile(this.configFilePath, config);
        } catch (error) {
            logger.error(`Error guardando config local: ${error.message}`);
        }
    }

    _loadLocalConfig() {
        try {
            const storedConfig = readConfigFile(this.configFilePath);
            if (storedConfig) {
                this.config = storedConfig;
                logger.info('📥 Última configuración cargada desde disco');
            }
        } catch (error) {
            logger.error(`Error cargando config local: ${error.message}`);
            try {
                const quarantinePath = quarantineConfigFile(this.configFilePath);
                if (quarantinePath) logger.warn(`Configuración dañada apartada en: ${path.basename(quarantinePath)}`);
            } catch (quarantineError) {
                logger.warn(`No se pudo apartar la configuración dañada: ${quarantineError.message}`);
            }
            this.config = null;
        }
    }

    // ==========================================
    // DEFAULTS (Espejo de tu DEFAULT_SETTINGS)
    // ==========================================

    _getDefaults() {
        return {
            general: { timezone: 'UTC', companyName: 'JC Time Control' },
            screenshots: {
                enabled: true,
                intervalMinutes: 5,
                quality: 80,
                maxWidth: 1920,
                maxHeight: 1080,
                maxFileSizeMB: 5,
                format: 'jpeg',
                blurSensitiveData: false
            },
            activity: {
                monitoringEnabled: true,
                sampleIntervalSeconds: 60,
                idleThresholdMinutes: 5,
                lowActivityThreshold: 30,
                trackActiveWindow: true
            },
            sessions: {
                autoCloseInactiveMinutes: 10,
                maxConcurrentSessions: 1,
                concurrentSessionPolicy: 'replace_previous',
                requireNotesOnStop: false
            },
            sync: {
                offlineModeEnabled: true,
                syncIntervalMinutes: 5,
                maxOfflineDays: 7,
                retryAttempts: 3
            },
            notifications: {
                emailEnabled: true,
                desktopEnabled: true,
                lowActivityAlert: true,
                inactivityAlert: true,
                dailySummary: false,
                weeklyReport: false
            },
            retention: {
                screenshotsDays: 90,
                activityLogsDays: 180,
                notificationsDays: 30,
                auditLogsDays: 365
            },
            alerts: {
                defaultCooldownMinutes: 60,
                maxAlertsPerHour: 10
            }
        };
    }

    // ==========================================
    // GETTERS (Acceso rápido a valores específicos)
    // ==========================================

    getConfig() {
        return this.config || this._getDefaults();
    }

    getScreenshotInterval() {
        return this.config?.screenshots?.intervalMinutes || 5;
    }

    isScreenshotEnabled() {
        return this.config?.screenshots?.enabled !== false;
    }

    getScreenshotQuality() {
        return this.config?.screenshots?.quality || 80;
    }

    getIdleThreshold() {
        return this.config?.activity?.idleThresholdMinutes || 5;
    }

    getTimezone() {
        return this.config?.general?.timezone || 'UTC';
    }

    getSyncInterval() {
        return this.config?.sync?.syncIntervalMinutes || 5;
    }

    getStatus() {
        return {
            hasConfig: this.config !== null,
            isSyncing: this.syncInterval !== null,
            screenshotInterval: this.getScreenshotInterval(),
            screenshotEnabled: this.isScreenshotEnabled(),
            timezone: this.getTimezone(),
            configVersion: this.config?.version || 'N/A'
        };
    }

    destroy() {
        this.stopSync();
        logger.info('⚙️ ConfigService destruido');
    }
}

export default new ConfigService();
