import { desktopCapturer, app, nativeImage, screen } from 'electron';
import logger from '../utils/logger.js';
import apiClient from './apiClient.js';
import timerService from './timerService.js';
import activityService from './activityService.js';
import fs from 'fs';
import { randomUUID } from 'node:crypto';
import path from 'path';
import os from 'os';
import secureLocalStorage from './secureLocalStorage.js';
import { buildScreenshotMetadata } from './screenshotMetadata.js';
import {
  createScreenshotQueueItem,
  evaluateScreenshotQueueItem,
  linkScreenshotSession,
  normalizeScreenshotQueue,
  normalizeScreenshotQueueItem,
  scheduleScreenshotRetry,
} from './screenshotQueuePolicy.js';
import connectionService from './connectionService.js';
import { reconcileQueueAfterProcessing } from './offlineQueuePolicy.js';
import {
  shouldCaptureScreenshot,
  shouldQueueScreenshotForLater,
  constrainScreenshotDimensions,
} from './screenshotCapturePolicy.js';
import { isRetryableScreenshotUploadError } from './screenshotUploadPolicy.js';
import { isAuthenticationRequiredError } from './authRefreshPolicy.js';
import {
  isManagedPendingScreenshotName,
  isPathInsideDirectory,
} from './localPathPolicy.js';
import { resolvePrimarySourceIndex } from './displayCapturePolicy.js';
import { quarantineLocalPath } from './localDataRecovery.js';
import { calculatePeriodActivity, createActivityBaseline } from './screenshotActivityPeriod.js';

class ScreenshotService {
  constructor() {
    this.captureInterval = null;
    this.intervalMs = 5 * 60 * 1000;
    this.isCapturing = false;
    this.lastCaptureAt = null;
    this.pendingQueue = [];
    this.processingPromise = null;
    this.capturePromise = null;
    this.jpegQuality = 80;
    this.maxWidth = 1920;
    this.maxHeight = 1080;
    this.maxFileSizeBytes = 5 * 1024 * 1024;
    this.blurSensitiveData = false;
    this.maxOfflineDays = 7;
    this.maxQueueSize = 500;
    this.statusListeners = new Set();
    this.activityBaseline = null;

    // ==========================================
    // 👇 RUTAS DE ALMACENAMIENTO LOCAL
    // ==========================================
    this.userDataPath = app.getPath('userData');
    this.queueFilePath = path.join(this.userDataPath, 'screenshot-queue.json');
    this.pendingDir = path.join(this.userDataPath, 'pending-screenshots');

    // Inicializar directorio de capturas pendientes
    this._initPendingDir();

    // Cargar cola existente (sobrevive a cierres abruptos)
    this.initializationPromise = this._loadQueue();

    // ==========================================
    // 👇 CRÍTICO 3: Listener de reconexión a internet
  }

  // ==========================================
  // INICIALIZACIÓN
  // ==========================================

  _initPendingDir() {
    try {
      if (!fs.existsSync(this.pendingDir)) {
        fs.mkdirSync(this.pendingDir, { recursive: true });
        logger.info(`📁 Directorio de capturas pendientes creado: ${this.pendingDir}`);
      }
    } catch (error) {
      logger.error(`Error creando directorio de pendientes: ${error.message}`);
    }
  }

  // ==========================================
  // 👇 DETECCIÓN DE CONECTIVIDAD REAL
  async _isBackendOnline() {
    const status = connectionService.getStatus();
    return status === null ? connectionService.checkNow() : status === true;
  }

  async _ensureInitialized() {
    await this.initializationPromise;
  }

  async start(intervalMinutes = 5) {
    await this._ensureInitialized();
    if (this.isCapturing) {
      logger.warn('⚠️ La captura ya está activa');
      return { success: false, message: 'La captura ya está activa' };
    }

    const numericInterval = Number(intervalMinutes);
    intervalMinutes = Number.isFinite(numericInterval)
      ? Math.min(60, Math.max(1, Math.floor(numericInterval)))
      : 5;
    this.intervalMs = intervalMinutes * 60 * 1000;
    this.isCapturing = true;
    this.activityBaseline = createActivityBaseline(activityService.getSnapshot());

    logger.info(`📸 Captura automática iniciada (cada ${intervalMinutes} min)`);

    // Capturas periódicas
    this.captureInterval = setInterval(() => {
      this._takeAndSend(false).catch(err => {
        logger.error('❌ Error no capturado en intervalo de captura:', err);
      });
    }, this.intervalMs);
    this._notifyStatus();

    // Si hay capturas pendientes de antes, intentar procesarlas
    if (this.pendingQueue.length > 0) {
      const isOnline = await this._isBackendOnline();
      if (!isOnline) {
        logger.info('📴 Sin internet al iniciar. Cola en espera.');
        return { success: true, intervalMs: this.intervalMs };
      }
    }

    return { success: true, intervalMs: this.intervalMs };
  }

  stop() {
    if (this.captureInterval) {
      clearInterval(this.captureInterval);
      this.captureInterval = null;
    }
    this.isCapturing = false;
    this.activityBaseline = null;
    this._notifyStatus();
    logger.info('📸 Captura automática detenida');
    return { success: true };
  }

  setBlurSensitiveData(enabled) {
    const wasEnabled = this.blurSensitiveData;
    this.blurSensitiveData = enabled === true;
    logger.info(`Privacidad de capturas: difuminado ${this.blurSensitiveData ? 'ACTIVO' : 'INACTIVO'}`);
    if (!wasEnabled && this.blurSensitiveData) {
      this._blurPendingQueue().catch(error => {
        logger.error(`No se pudo proteger la cola de capturas: ${error.message}`);
      });
    }
  }

  _applyIrreversibleBlur(image) {
    const size = image.getSize();
    const reducedWidth = Math.max(24, Math.round(size.width * 0.03));
    const reducedHeight = Math.max(14, Math.round(size.height * 0.03));
    return image
      .resize({ width: reducedWidth, height: reducedHeight, quality: 'good' })
      .resize({ width: size.width, height: size.height, quality: 'best' });
  }

  _constrainImage(image) {
    const size = image.getSize();
    const target = constrainScreenshotDimensions({
      width: size.width,
      height: size.height,
      maxWidth: this.maxWidth,
      maxHeight: this.maxHeight,
    });

    return target.resized
      ? image.resize({ width: target.width, height: target.height, quality: 'best' })
      : image;
  }

  async _blurPendingQueue() {
    await this._ensureInitialized();
    let changed = false;
    for (const item of this.pendingQueue) {
      if (!item.filePath || item.metadata?.privacyBlurred === true || !fs.existsSync(item.filePath)) continue;
      const sourceBuffer = secureLocalStorage.readBuffer(item.filePath);
      const image = nativeImage.createFromBuffer(sourceBuffer);
      if (image.isEmpty()) throw new Error(`Captura local inválida: ${item.id}`);
      const protectedBuffer = this._applyIrreversibleBlur(image).toJPEG(this.jpegQuality);
      secureLocalStorage.writeBuffer(item.filePath, protectedBuffer);
      item.metadata = { ...item.metadata, privacyBlurred: true };
      changed = true;
    }
    if (changed) await this._saveQueue();
  }

  // ==========================================
  // CAPTURA: Ahora toma TODOS los monitores
  // ==========================================

  async _captureScreen() {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: this.maxWidth, height: this.maxHeight }
      });

      if (!sources || sources.length === 0) {
        throw new Error('No se encontraron pantallas disponibles');
      }

      // 👇 Capturar CADA monitor por separado
      const captures = [];
      const primarySourceIndex = resolvePrimarySourceIndex(
        sources,
        screen.getPrimaryDisplay()?.id,
      );

      for (let i = 0; i < sources.length; i++) {
        const source = sources[i];
        const originalImage = this._constrainImage(source.thumbnail);
        const image = this.blurSensitiveData
          ? this._applyIrreversibleBlur(originalImage)
          : originalImage;
        const jpegBuffer = this._encodeJpegWithinLimit(image);

        captures.push({
          buffer: jpegBuffer,
          mimeType: 'image/jpeg',
          format: 'jpeg',
          width: image.getSize().width,
          height: image.getSize().height,
          size: jpegBuffer.length,
          displayIndex: i,                          // 👈 Índice del monitor (0, 1, 2...)
          displayName: source.name || `Monitor ${i + 1}`, // 👈 Nombre del monitor
          isPrimary: i === primarySourceIndex,
          privacyBlurred: this.blurSensitiveData
        });
      }

      logger.info(`📸 ${captures.length} monitor(es) capturado(s): ${captures.map(c => c.displayName).join(', ')}`);

      return captures; // 👈 Ahora devuelve un ARRAY de capturas

    } catch (error) {
      logger.error(`Error capturando pantalla: ${error.message}`);
      throw error;
    }
  }

  // ==========================================
  // CAPTURA + ENVÍO: Adaptado para múltiples monitores
  // ==========================================

  async _takeAndSend(first) {
    if (this.capturePromise) {
      logger.warn('Captura automática omitida: ya existe una captura en curso.');
      return;
    }
    this.capturePromise = this._performTakeAndSend(first);
    try {
      return await this.capturePromise;
    } finally {
      this.capturePromise = null;
    }
  }

  async _performTakeAndSend(first) {
    try {
      if (!shouldCaptureScreenshot({
        serviceActive: this.isCapturing,
        timerStatus: timerService.getStatus(),
      })) {
        logger.debug('⏸️ Timer no está activo, omitiendo captura');
        return;
      }

      logger.info('📸 Tomando captura de pantalla...');

      // 1. Capturar TODOS los monitores (devuelve un ARRAY)
      const captures = await this._captureScreen();

      if (!shouldCaptureScreenshot({
        serviceActive: this.isCapturing,
        timerStatus: timerService.getStatus(),
      })) {
        logger.info('Captura descartada porque el seguimiento fue pausado o detenido.');
        return;
      }

      // 2. Metadata base
      const activitySnapshot = activityService.getSnapshot();
      const periodActivity = calculatePeriodActivity(activitySnapshot, this.activityBaseline);
      this.activityBaseline = periodActivity.baseline;
      const screenshotActivitySnapshot = {
        ...activitySnapshot,
        activityPercentage: periodActivity.percentage,
      };
      const baseMetadata = buildScreenshotMetadata({
        activity: screenshotActivitySnapshot,
        sessionId: timerService.sessionId,
        hostname: os.hostname(),
        firstCapture: first,
      });

      // 3. 👇 CLAVE: Iterar sobre CADA captura del array
      for (const capture of captures) {
        if (!shouldCaptureScreenshot({
          serviceActive: this.isCapturing,
          timerStatus: timerService.getStatus(),
        })) {
          logger.info('Carga de capturas interrumpida por pausa o detención.');
          break;
        }
        let metadata = baseMetadata;
        try {
          // 👇 DEBUG: Verificar que el buffer existe
          if (!capture.buffer || capture.buffer.length === 0) {
            logger.error(`❌ Buffer vacío para ${capture.displayName}. Saltando.`);
            continue;
          }

          metadata = buildScreenshotMetadata({
            activity: screenshotActivitySnapshot,
            capture,
            sessionId: timerService.sessionId,
            hostname: os.hostname(),
            firstCapture: first,
            timestamp: baseMetadata.timestamp,
          });
          metadata.clientCaptureId = `capture-${randomUUID()}`;

          if (shouldQueueScreenshotForLater({
            sessionId: metadata.sessionId,
            hasToken: Boolean(apiClient.getToken()),
          })) {
            await this._addToQueue('Pendiente de sesión o autenticación', capture, metadata);
            continue;
          }

          // 👇 Se pasa el objeto individual, NO el array
          await this._uploadScreenshot(capture, metadata);

          logger.info(`✅ Captura enviada: ${capture.displayName} (${capture.width}x${capture.height})`);
        } catch (uploadErr) {
          logger.error(`❌ Error subiendo ${capture.displayName}: ${uploadErr.message}`);
          if (
            isAuthenticationRequiredError(uploadErr) ||
            isRetryableScreenshotUploadError(uploadErr)
          ) {
            await this._addToQueue(uploadErr.message, capture, metadata);
          } else {
            logger.warn('Captura descartada por un error permanente de validación o autorización.');
          }
        }
      }

      this.lastCaptureAt = new Date();
      this._notifyStatus();

    } catch (error) {
      logger.error(`❌ Error en captura: ${error.message}`);
    }
  }

  async _uploadScreenshot(screenshot, metadata) {
    try {
      const FormData = (await import('form-data')).default;
      const formData = new FormData();

      // 👇 Asegurar que el buffer sea un Buffer puro de Node.js
      const safeBuffer = Buffer.isBuffer(screenshot.buffer)
        ? screenshot.buffer
        : Buffer.from(screenshot.buffer);

      const fileName = metadata.displayIndex !== undefined
        ? `screenshot-${Date.now()}-monitor${metadata.displayIndex}.jpg`
        : `screenshot-${Date.now()}.jpg`;

      formData.append('screenshot', safeBuffer, {
        filename: fileName,
        contentType: screenshot.mimeType || 'image/jpeg'
      });

      // 👇 SOLO agregar campos que tengan valor (evita undefined)
      if (metadata.timestamp) formData.append('timestamp', metadata.timestamp);
      if (metadata.clientCaptureId) formData.append('clientCaptureId', metadata.clientCaptureId);
      if (metadata.sessionId && !metadata.sessionId.startsWith('offline-')) {
        formData.append('sessionId', metadata.sessionId);
      }
      if (metadata.activeWindow) formData.append('activeWindow', metadata.activeWindow);
      if (metadata.activeApp) formData.append('activeApp', metadata.activeApp);
      if (metadata.activityPercentage !== undefined && metadata.activityPercentage !== null) {
        formData.append('activityPercentage', String(metadata.activityPercentage));
      }

      // 👇 ESTOS ERAN LOS CULPABLES: podían llegar como undefined
      formData.append('totalDuration', String(metadata.totalDuration || 0));
      formData.append('activeTime', String(metadata.activeTime || 0));
      formData.append('idleTime', String(metadata.idleTime || 0));
      if (metadata.screenWidth) formData.append('screenWidth', String(metadata.screenWidth));
      if (metadata.screenHeight) formData.append('screenHeight', String(metadata.screenHeight));

      // Campos de monitor
      if (metadata.displayIndex !== undefined && metadata.displayIndex !== null) {
        formData.append('displayIndex', String(metadata.displayIndex));
      }
      if (metadata.displayName) formData.append('displayName', metadata.displayName);
      if (metadata.isPrimary !== undefined) formData.append('isPrimary', String(metadata.isPrimary));
      formData.append('privacyBlurred', String(metadata.privacyBlurred === true));

      const response = await apiClient.post('/screenshots', formData, {
        headers: { ...formData.getHeaders() },
        maxBodyLength: 10 * 1024 * 1024
      });

      if (!response.data.success) {
        throw new Error(response.data.message || 'Error al subir captura');
      }

      return response.data.data;
    } catch (error) {
      logger.error(`Error subiendo captura: ${error.message}`);
      throw error;
    }
  }

  // ==========================================
  // 👇 CRÍTICO 1: COLA CON IMAGEN EN DISCO
  // ==========================================

  async _addToQueue(errorMessage = 'Unknown error', failedCapture = null, failedMetadata = null) {
    await this._ensureInitialized();
    try {
      const screenshot = failedCapture;
      let metadata = failedMetadata;

      if (!screenshot?.buffer || screenshot.buffer.length === 0) {
        logger.warn('No se agregó una captura vacía a la cola offline.');
        return false;
      }

      // Si no nos pasaron metadata, obtenerla ahora
      if (!metadata) {
        const activitySnapshot = activityService.getSnapshot();
        metadata = buildScreenshotMetadata({
          activity: activitySnapshot,
          capture: screenshot || {},
          sessionId: timerService.sessionId,
          hostname: os.hostname(),
        });
      }

      // Guardar imagen en disco
      let filePath = null;
      if (screenshot && screenshot.buffer) {
        const fileName = `pending-${Date.now()}-m${screenshot.displayIndex || 0}-${Math.random().toString(36).substring(7)}.jpg`;
        filePath = path.join(this.pendingDir, fileName);
        secureLocalStorage.writeBuffer(filePath, screenshot.buffer);
        logger.info(`💾 Imagen guardada en disco: ${fileName}`);
      }

      this.pendingQueue.push(createScreenshotQueueItem({
        filePath,
        metadata: {
          ...metadata,
          screenWidth: screenshot?.width,
          screenHeight: screenshot?.height,
          displayIndex: screenshot?.displayIndex,
          displayName: screenshot?.displayName,
          isPrimary: screenshot?.isPrimary,
          privacyBlurred: screenshot?.privacyBlurred === true
        },
        errorMessage,
      }));

      while (this.pendingQueue.length > this.maxQueueSize) {
        const discarded = this.pendingQueue.shift();
        await this._deletePendingFile(discarded?.filePath);
      }

      await this._saveQueue();
      logger.info(`📥 Captura agregada a cola. Pendientes: ${this.pendingQueue.length}`);
      return true;

    } catch (error) {
      logger.error(`Error crítico agregando a cola: ${error.message}`);
      return false;
    }
  }

  // ==========================================
  // 👇 CRÍTICO 2: PROCESAR COLA CON REINTENTO REAL
  // ==========================================

  async processQueue() {
    if (this.processingPromise) return this.processingPromise;
    this.processingPromise = this._processQueue();
    try {
      return await this.processingPromise;
    } finally {
      this.processingPromise = null;
    }
  }

  async _processQueue() {
    await this._ensureInitialized();
    if (this.pendingQueue.length === 0) {
      logger.debug('Cola vacía, nada que procesar');
      return;
    }
    if (!apiClient.getToken()) {
      logger.debug('Capturas pendientes en espera de autenticación.');
      return;
    }

    // Verificar que hay internet antes de intentar
    const isOnline = await this._isBackendOnline();
    if (!isOnline) {
      logger.warn('📴 Sin conexión real a internet. Cola en espera.');
      return;
    }

    logger.info(`🔄 Procesando cola: ${this.pendingQueue.length} capturas pendientes`);

    const remaining = [];
    const processingItems = [...this.pendingQueue];
    let successCount = 0;
    let failCount = 0;
    let discardedCount = 0;

    for (const queuedItem of processingItems) {
      let item = normalizeScreenshotQueueItem(queuedItem);
      try {
        const decision = evaluateScreenshotQueueItem(item);
        item = decision.item;

        if (decision.action === 'wait') {
          remaining.push(item);
          continue;
        }

        // 1. Verificar si superó el máximo de reintentos
        if (decision.action === 'discard') {
          logger.warn(
            `Captura ${item?.id || queuedItem?.id || 'desconocida'} descartada (${decision.reason}).`,
          );
          await this._deletePendingFile(item?.filePath);
          discardedCount++;
          continue;
        }

        if (!isPathInsideDirectory(item.filePath, this.pendingDir)) {
          logger.error(`Captura ${item.id} descartada: ruta local no autorizada.`);
          discardedCount++;
          continue;
        }

        // 2. Verificar que el archivo existe en disco
        if (!item.filePath || !fs.existsSync(item.filePath)) {
          logger.warn(`⚠️ Captura ${item.id} no tiene archivo en disco. Descartando.`);
          discardedCount++;
          continue;
        }

        // 3. Leer el buffer del archivo
        let imageBuffer = secureLocalStorage.readBuffer(item.filePath);
        const pendingImage = nativeImage.createFromBuffer(imageBuffer);
        if (pendingImage.isEmpty()) {
          throw new Error(`Captura local inválida: ${item.id}`);
        }
        const constrainedImage = this._constrainImage(pendingImage);
        const constrainedSize = constrainedImage.getSize();
        const originalSize = pendingImage.getSize();
        if (
          constrainedSize.width !== originalSize.width ||
          constrainedSize.height !== originalSize.height
        ) {
          imageBuffer = this._encodeJpegWithinLimit(constrainedImage);
          secureLocalStorage.writeBuffer(item.filePath, imageBuffer);
          item.metadata = {
            ...item.metadata,
            screenWidth: constrainedSize.width,
            screenHeight: constrainedSize.height,
          };
          logger.info(
            `Captura pendiente ${item.id} ajustada proporcionalmente a ${constrainedSize.width}x${constrainedSize.height}.`,
          );
        }

        // 4. Reconstruir el objeto screenshot
        const screenshot = {
          buffer: imageBuffer,
          mimeType: 'image/jpeg',
          format: 'jpeg',
          size: imageBuffer.length
        };

        // 5. REINTENTAR LA SUBIDA REAL al backend
        await this._uploadScreenshot(screenshot, item.metadata);

        // 6. Si llegó aquí, la subida fue exitosa
        logger.info(`✅ Captura ${item.id} sincronizada exitosamente`);
        await this._deletePendingFile(item.filePath);
        successCount++;

      } catch (error) {
        // 7. La subida falló de nuevo
        if (isAuthenticationRequiredError(error)) {
          remaining.push(item);
          logger.warn(`Captura ${item?.id || 'desconocida'} conservada hasta iniciar sesión nuevamente.`);
          continue;
        }
        if (!isRetryableScreenshotUploadError(error)) {
          await this._deletePendingFile(item?.filePath);
          discardedCount++;
          logger.warn(`Captura ${item?.id || 'desconocida'} descartada por un error HTTP permanente.`);
          continue;
        }
        item = scheduleScreenshotRetry(item, error);
        failCount++;
        logger.warn(`🔁 Captura ${item.id} falló (intento ${item.retryCount}/${item.maxRetries}): ${error.message}`);
        remaining.push(item);
      }
    }

    // 8. Actualizar la cola con los que aún están pendientes
    this.pendingQueue = reconcileQueueAfterProcessing({
      processingItems,
      currentItems: this.pendingQueue,
      remainingItems: remaining,
      getId: item => item?.id,
    });
    await this._saveQueue();

    logger.info(`📊 Cola procesada: ${successCount} exitosas, ${failCount} fallidas, ${discardedCount} descartadas. Restantes: ${remaining.length}`);
  }

  // ==========================================
  // PERSISTENCIA DE COLA (JSON)
  // ==========================================

  async _saveQueue() {
    try {
      this.pendingQueue = normalizeScreenshotQueue(this.pendingQueue);
      secureLocalStorage.writeJson(this.queueFilePath, this.pendingQueue);
      queueMicrotask(() => timerService.notifySyncStatus());
      this._notifyStatus();
    } catch (error) {
      logger.error(`Error guardando cola: ${error.message}`);
    }
  }

  async _loadQueue() {
    try {
      if (fs.existsSync(this.queueFilePath)) {
        const storedQueue = secureLocalStorage.readJson(this.queueFilePath, []);
        this.pendingQueue = normalizeScreenshotQueue(storedQueue)
          .filter(item => {
            const allowed = isPathInsideDirectory(item.filePath, this.pendingDir);
            if (!allowed) logger.error(`Entrada de captura descartada por ruta no autorizada: ${item.id}`);
            return allowed;
          });
        logger.info(`📥 Cola cargada: ${this.pendingQueue.length} capturas pendientes`);

        // Verificar que los archivos aún existen (limpieza post-cierre abrupto)
        const validQueue = [];
        const oldestAllowed = Date.now() - this.maxOfflineDays * 86400000;
        for (const item of this.pendingQueue) {
          const createdAt = new Date(item.createdAt || 0).getTime();
          if (
            createdAt >= oldestAllowed &&
            item.filePath &&
            fs.existsSync(item.filePath)
          ) {
            secureLocalStorage.migrateFile(item.filePath);
            validQueue.push(item);
          } else {
            await this._deletePendingFile(item.filePath);
            logger.warn(`🗑️ Captura ${item.id} descartada: archivo no encontrado en disco`);
          }
        }
        this.pendingQueue = validQueue.slice(-this.maxQueueSize);
        secureLocalStorage.writeJson(this.queueFilePath, this.pendingQueue);
      }
      await this._cleanupOrphanedFiles();
    } catch (error) {
      logger.error(`Error cargando cola: ${error.message}`);
      try {
        const recoveryId = Date.now();
        const queueRecovery = quarantineLocalPath(this.queueFilePath, recoveryId);
        const filesRecovery = quarantineLocalPath(this.pendingDir, recoveryId);
        this._initPendingDir();
        if (queueRecovery || filesRecovery) {
          logger.warn('La cola de capturas dañada fue apartada para recuperación manual.');
        }
      } catch (recoveryError) {
        logger.warn(`No se pudieron apartar las capturas dañadas: ${recoveryError.message}`);
      }
      this.pendingQueue = [];
    }
  }

  // ==========================================
  // UTILIDADES
  // ==========================================

  async _deletePendingFile(filePath) {
    try {
      if (!isPathInsideDirectory(filePath, this.pendingDir)) {
        if (filePath) logger.error('Se rechazó la eliminación de una ruta fuera del directorio de capturas.');
        return;
      }
      if (filePath && fs.existsSync(filePath)) {
        await fs.promises.unlink(filePath);
        logger.debug(`🗑️ Archivo temporal eliminado: ${path.basename(filePath)}`);
      }
    } catch (error) {
      logger.error(`Error eliminando archivo temporal: ${error.message}`);
    }
  }

  getStatus() {
    return {
      isCapturing: this.isCapturing,
      intervalMs: this.intervalMs,
      intervalMinutes: this.intervalMs / 60000,
      lastCaptureAt: this.lastCaptureAt,
      pendingCount: this.pendingQueue.length,
      pendingDir: this.pendingDir
      // 👇 Eliminado: isOnline (ya no usamos net)
    };
  }
  setQuality(quality) {
    this.jpegQuality = Math.max(10, Math.min(100, quality));
    logger.info(`📸 Calidad de captura actualizada: ${this.jpegQuality}%`);
  }

  setCaptureLimits({ maxWidth, maxHeight, maxFileSizeMB } = {}) {
    this.maxWidth = Math.min(7680, Math.max(640, Math.floor(Number(maxWidth) || 1920)));
    this.maxHeight = Math.min(4320, Math.max(480, Math.floor(Number(maxHeight) || 1080)));
    const safeMegabytes = Math.min(5, Math.max(1, Number(maxFileSizeMB) || 5));
    this.maxFileSizeBytes = Math.floor(safeMegabytes * 1024 * 1024);
    logger.info(
      `Límites de captura actualizados: ${this.maxWidth}x${this.maxHeight}, ${safeMegabytes} MB`,
    );
  }

  _encodeJpegWithinLimit(image) {
    for (let quality = this.jpegQuality; quality >= 10; quality -= 10) {
      const buffer = image.toJPEG(quality);
      if (buffer.length <= this.maxFileSizeBytes) return buffer;
    }
    const error = new Error("La captura no puede comprimirse dentro del tamaño configurado");
    error.code = "SCREENSHOT_SIZE_LIMIT";
    throw error;
  }

  async _cleanupOrphanedFiles() {
    const referenced = new Set(
      this.pendingQueue.map(item => path.resolve(item.filePath).toLowerCase()),
    );
    const entries = await fs.promises.readdir(this.pendingDir, { withFileTypes: true });
    let deleted = 0;
    for (const entry of entries) {
      if (!entry.isFile() || !isManagedPendingScreenshotName(entry.name)) continue;
      const filePath = path.join(this.pendingDir, entry.name);
      if (referenced.has(path.resolve(filePath).toLowerCase())) continue;
      await this._deletePendingFile(filePath);
      deleted += 1;
    }
    if (deleted > 0) {
      logger.info('Se eliminaron ' + deleted + ' archivos de captura huérfanos.');
    }
  }

  async replaceSessionId(localSessionId, remoteSessionId) {
    await this._ensureInitialized();
    const linked = linkScreenshotSession(
      this.pendingQueue,
      localSessionId,
      remoteSessionId,
    );
    if (linked.replacements === 0) return;
    this.pendingQueue = linked.items;
    await this._saveQueue();
    logger.info(
      `🔗 ${linked.replacements} capturas asociadas a la sesión ${remoteSessionId}.`,
    );
  }

  async discardSessionItems(sessionId) {
    await this._ensureInitialized();
    if (!sessionId) return;
    const discarded = this.pendingQueue.filter(
      item => String(item?.metadata?.sessionId || '') === String(sessionId),
    );
    if (discarded.length === 0) return;
    this.pendingQueue = this.pendingQueue.filter(
      item => String(item?.metadata?.sessionId || '') !== String(sessionId),
    );
    await Promise.all(discarded.map(item => this._deletePendingFile(item.filePath)));
    await this._saveQueue();
    logger.warn(`Se descartaron ${discarded.length} capturas de la sesión inválida ${sessionId}.`);
  }

  onStatusChange(listener) {
    if (typeof listener !== 'function') return () => {};
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  _notifyStatus() {
    const status = this.getStatus();
    this.statusListeners.forEach((listener) => {
      try {
        listener(status);
      } catch (error) {
        logger.warn(`No se pudo notificar el estado de capturas: ${error.message}`);
      }
    });
  }

  setOfflinePolicy({ maxOfflineDays, maxPendingScreenshots } = {}) {
    this.maxOfflineDays = Math.min(30, Math.max(1, Number(maxOfflineDays) || 7));
    this.maxQueueSize = Math.min(500, Math.max(10, Number(maxPendingScreenshots) || 500));
  }

  async takeManualScreenshot() {
    await this._ensureInitialized();
    if (this.capturePromise) {
      return {
        success: false,
        code: 'CAPTURE_IN_PROGRESS',
        message: 'Ya hay una captura en curso. Inténtalo nuevamente en unos segundos.',
      };
    }
    this.capturePromise = this._performManualScreenshot();
    try {
      return await this.capturePromise;
    } finally {
      this.capturePromise = null;
    }
  }

  async _performManualScreenshot() {
    try {
      if (!shouldCaptureScreenshot({
        serviceActive: this.isCapturing,
        timerStatus: timerService.getStatus(),
      })) {
        return {
          success: false,
          message: 'Las capturas solo están disponibles durante el seguimiento activo.',
        };
      }
      const captures = await this._captureScreen(); // 👈 Array
      if (!shouldCaptureScreenshot({
        serviceActive: this.isCapturing,
        timerStatus: timerService.getStatus(),
      })) {
        return {
          success: false,
          message: 'La captura se canceló porque el seguimiento fue pausado o detenido.',
        };
      }
      const activitySnapshot = activityService.getSnapshot();
      const results = [];

      // 👇 Iterar sobre cada monitor
      for (const capture of captures) {
        if (!shouldCaptureScreenshot({
          serviceActive: this.isCapturing,
          timerStatus: timerService.getStatus(),
        })) break;
        const metadata = buildScreenshotMetadata({
          activity: activitySnapshot,
          capture,
          sessionId: timerService.sessionId,
          hostname: os.hostname(),
        });
        metadata.clientCaptureId = `capture-${randomUUID()}`;
        if (shouldQueueScreenshotForLater({
          sessionId: metadata.sessionId,
          hasToken: Boolean(apiClient.getToken()),
        })) {
          await this._addToQueue('Pendiente de sesión o autenticación', capture, metadata);
          results.push({ queued: true, displayIndex: metadata.displayIndex });
          continue;
        }

        try {
          const result = await this._uploadScreenshot(capture, metadata);
          results.push(result);
        } catch (error) {
          if (
            isAuthenticationRequiredError(error) ||
            isRetryableScreenshotUploadError(error)
          ) {
            await this._addToQueue(error.message, capture, metadata);
            results.push({ queued: true, displayIndex: metadata.displayIndex });
            continue;
          }
          throw error;
        }
      }

      this.lastCaptureAt = new Date();
      this._notifyStatus();

      return { success: true, data: { captures: results, capturedAt: this.lastCaptureAt } };
    } catch (error) {
      logger.error(`Error en captura manual: ${error.message}`);
      return { success: false, message: error.message };
    }
  }

  // ==========================================
  // LIMPIEZA (Al cerrar la app)
  // ==========================================

  destroy() {
    if (this.captureInterval) {
      clearInterval(this.captureInterval);
      this.captureInterval = null;
    }
    this.isCapturing = false;
    this.statusListeners.clear();
    logger.info('📸 ScreenshotService destruido');
  }
}

export default new ScreenshotService();
