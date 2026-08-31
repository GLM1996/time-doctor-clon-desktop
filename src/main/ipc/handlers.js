import { app, BrowserWindow, ipcMain, shell } from "electron";

import { IPC_CHANNELS } from "./channels.js";

import logger from "../utils/logger.js";
import apiClient from "../services/apiClient.js";
import { authStore, credentialStore } from "../services/store.js";
import timerService from "../services/timerService.js";
import screenshotService from "../services/screenshotService.js";
import trayService from "../services/trayService.js";
import connectionService from "../services/connectionService.js";
import { evaluateLogoutSyncState } from "../services/logoutSyncPolicy.js";
import { canUsePendingData } from "../services/pendingDataOwnerPolicy.js";
import crashReporterService from "../services/crashReporterService.js";
import { persistAuthSession } from "../services/authPersistencePolicy.js";
import { revokeRemoteSession } from "../services/remoteSessionCleanup.js";
import {
  normalizeBreakPayload,
  normalizeLoginPayload,
  normalizeScreenshotStartPayload,
  normalizeTimerStartPayload,
  normalizeTimerStopPayload,
} from "./payloadValidation.js";

const ALLOWED_EXTERNAL_HOSTS = new Set([
  "logyourtime.com",
  "www.logyourtime.com",
]);

let handlersRegistered = false;
let requestApplicationQuit = () => app.quit();

export function registerIpcHandlers({ onQuit } = {}) {
  /*
   * Evita registrar los mismos handlers más de una vez.
   *
   * Esto es especialmente útil durante desarrollo,
   * recarga en caliente o recreación de ventanas.
   */
  if (handlersRegistered) {
    logger.warn("Los handlers IPC ya estaban registrados.");
    return;
  }

  handlersRegistered = true;
  if (typeof onQuit === "function") {
    requestApplicationQuit = onQuit;
  }

  logger.info("Registrando handlers IPC");

  registerAppHandlers();
  registerAuthHandlers();
  registerTimerHandlers();
  registerScreenshotHandlers();

  logger.info("Handlers IPC registrados correctamente");
}

function registerAppHandlers() {
  ipcMain.on(IPC_CHANNELS.APP_CONNECTION_HINT, (_event, payload = {}) => {
    try {
      connectionService.handleNetworkHint(payload?.online === true);
    } catch (error) {
      logger.warn(`No se pudo aplicar la señal de conexión: ${error.message}`);
    }
  });
  /*
   * Estos canales usan invoke() desde el preload,
   * por eso se registran con ipcMain.handle().
   */
  ipcMain.handle(IPC_CHANNELS.APP_GET_VERSION, () => {
    return app.getVersion();
  });

  ipcMain.handle(IPC_CHANNELS.APP_GET_PLATFORM, () => {
    return {
      platform: process.platform,
      arch: process.arch,
      electronVersion: process.versions.electron,
      nodeVersion: process.versions.node,
      chromeVersion: process.versions.chrome,
    };
  });

  ipcMain.handle(
    IPC_CHANNELS.APP_OPEN_EXTERNAL,
    async (_event, payload = {}) => {
      try {
        const normalizedUrl = validateExternalUrl(payload?.url);

        await shell.openExternal(normalizedUrl);

        logger.info(`Enlace externo abierto: ${normalizedUrl}`);

        return {
          success: true,
        };
      } catch (error) {
        logger.error(`Error abriendo enlace externo: ${error.message}`);

        return {
          success: false,
          message: error.message || "No fue posible abrir el enlace.",
        };
      }
    },
  );

  /*
   * Estos canales usan send() desde el preload,
   * por eso se registran con ipcMain.on().
   */
  ipcMain.on(IPC_CHANNELS.APP_MINIMIZE, (event) => {
    try {
      const window = BrowserWindow.fromWebContents(event.sender);

      if (!window || window.isDestroyed()) {
        logger.warn("No se encontró una ventana válida para minimizar.");

        return;
      }

      window.minimize();

      logger.info("Ventana principal minimizada.");
    } catch (error) {
      logger.error(`Error minimizando aplicación: ${error.message}`);
    }
  });

  ipcMain.on(IPC_CHANNELS.APP_QUIT, () => {
    logger.info("Solicitud de cierre definitivo recibida.");

    Promise.resolve(requestApplicationQuit()).catch((error) => {
      logger.error(`No se pudo cerrar la aplicación: ${error.message}`);
    });
  });
}

function registerAuthHandlers() {
  ipcMain.handle(IPC_CHANNELS.AUTH_GET_SAVED_CREDENTIALS, async () => {
    const credentials = credentialStore.get();
    return credentials.email && credentials.password
      ? { success: true, data: credentials }
      : { success: true, data: null };
  });

  ipcMain.handle(IPC_CHANNELS.AUTH_GET_STATUS, async () => {
    const isAuthenticated = authStore.isAuthenticated();

    const savedUser = authStore.getUser();

    if (!isAuthenticated) {
      return {
        isAuthenticated: false,
        user: null,
      };
    }

    const token = authStore.getToken();

    if (token) {
      apiClient.setToken(token);
    }

    try {
      const response = await apiClient.get("/auth/profile");

      if (response.data?.success) {
        const freshUser = response.data?.data?.user || response.data?.data;

        if (!freshUser) {
          throw new Error(
            "El servidor no devolvió la información del usuario.",
          );
        }

        authStore.setUser(freshUser);
        trayService.refreshIdentity();

        return {
          isAuthenticated: true,
          user: freshUser,
          connected: true,
        };
      }

      throw new Error(
        response.data?.message || "No fue posible verificar la sesión.",
      );
    } catch (error) {
      const status = error.response?.status;

      if (status === 401 || status === 403) {
        logger.warn("Token inválido o expirado. Limpiando sesión.");

        authStore.clearAll();
        apiClient.clearToken();
        trayService.refreshIdentity();

        return {
          isAuthenticated: false,
          user: null,
          connected: true,
        };
      }

      /*
       * Si el servidor no está disponible, mantenemos
       * temporalmente la sesión guardada.
       */
      logger.warn(
        `No se pudo verificar el token. Status: ${
          status || "sin respuesta"
        }. Se mantiene la sesión local.`,
      );

      return {
        isAuthenticated: Boolean(savedUser),
        user: savedUser || null,
        connected: connectionService.getStatus() === true,
      };
    }
  });

  ipcMain.handle(IPC_CHANNELS.AUTH_LOGIN, async (_event, payload = {}) => {
    try {
      const previousUser = authStore.getUser();
      const { email, password, rememberCredentials } = normalizeLoginPayload(payload);

      if (!rememberCredentials) credentialStore.clear();

      if (!email) {
        return {
          success: false,
          message: "Ingresa un correo electrónico válido.",
        };
      }

      if (!password) {
        return {
          success: false,
          message: "Ingresa tu contraseña.",
        };
      }

      logger.info(`Intentando login para: ${email}`);

      const response = await apiClient.post("/auth/login", { email, password });

      if (!response.data?.success) {
        return {
          success: false,
          message: response.data?.message || "No fue posible iniciar sesión.",
        };
      }

      const token =
        response.data?.data?.accessToken || response.data?.data?.token;
      const refreshToken = response.data?.data?.refreshToken;
      const sessionId = response.data?.data?.sessionId;

      const user = response.data?.data?.user;

      if (!token || !user) {
        throw new Error("La respuesta de autenticación está incompleta.");
      }

      const pendingTotal = timerService.getSyncStatus().pendingTotal;
      if (!canUsePendingData({ previousUser, nextUser: user, pendingTotal })) {
        try {
          await apiClient.post(
            "/auth/logout",
            { refreshToken, sessionId },
            {
              _skipAuthRefresh: true,
              headers: { Authorization: `Bearer ${token}` },
            },
          );
        } catch (cleanupError) {
          logger.warn(
            `No se pudo revocar el login rechazado: ${cleanupError.message}`,
          );
        }
        return {
          success: false,
          code: "PENDING_DATA_OWNER_MISMATCH",
          pendingTotal,
          message:
            "Este equipo conserva datos pendientes de otra cuenta. Inicia sesión con la cuenta original para sincronizarlos antes de cambiar de usuario.",
        };
      }

      if (
        !persistAuthSession(authStore, {
          accessToken: token,
          refreshToken,
          sessionId,
        })
      ) {
        await revokeRemoteSession({
          post: (...args) => apiClient.post(...args),
          accessToken: token,
          refreshToken,
          sessionId,
          onError: (cleanupError) =>
            logger.warn(
              `No se pudo revocar la sesion sin persistir: ${cleanupError.message}`,
            ),
        });
        return {
          success: false,
          code: "SECURE_STORAGE_UNAVAILABLE",
          message:
            "No fue posible proteger la sesión en este equipo. Verifica la seguridad del sistema operativo e inténtalo nuevamente.",
        };
      }
      apiClient.setToken(token);

      let currentUser = user;

      try {
        const profileResponse = await apiClient.get("/auth/profile");

        if (profileResponse.data?.success) {
          currentUser =
            profileResponse.data?.data?.user ||
            profileResponse.data?.data ||
            user;
        }
      } catch (profileError) {
        logger.warn(
          `No se pudo completar el perfil tras el login: ${profileError.message}`,
        );
      }

      authStore.setUser(currentUser);
      if (rememberCredentials && !credentialStore.set({ email, password })) {
        logger.warn("No fue posible proteger las credenciales recordadas.");
      }

      trayService.refreshIdentity();

      Promise.allSettled([
        timerService.syncPendingData(),
        screenshotService.processQueue(),
        crashReporterService.flush(),
      ]).then((results) => {
        const failures = results.filter(
          (result) => result.status === "rejected",
        );
        if (failures.length > 0) {
          logger.warn(
            `La sincronización posterior al login terminó con ${failures.length} operación(es) fallida(s).`,
          );
        }
      });

      logger.info("Login exitoso.");

      return {
        success: true,
        user: currentUser,
      };
    } catch (error) {
      logger.error(
        `Error en login: ${error.response?.data?.message || error.message}`,
      );

      return {
        success: false,
        message:
          error.response?.data?.message ||
          error.message ||
          "Error de conexión con el servidor.",
      };
    }
  });

  ipcMain.handle(IPC_CHANNELS.AUTH_LOGOUT, async () => {
    logger.info("Cerrando sesión.");

    /*
     * Guardar el token antes de limpiar sería necesario
     * si luego deseas notificar el logout al backend.
     */
    try {
      if (timerService.getStatus().isRunning) {
        await timerService.stop("system");
      }
    } catch (error) {
      logger.error(
        `No se pudo cerrar la jornada antes del logout: ${error.message}`,
      );

      return {
        success: false,
        message:
          "No se pudo cerrar la jornada activa. Detén el temporizador e inténtalo nuevamente.",
      };
    }

    const logoutSyncState = evaluateLogoutSyncState(
      timerService.getSyncStatus(),
    );
    if (!logoutSyncState.canLogout) {
      logger.warn(
        `Logout aplazado: ${logoutSyncState.pendingTotal} operaciones pendientes.`,
      );
      return {
        success: false,
        code: "PENDING_SYNC",
        pendingTotal: logoutSyncState.pendingTotal,
        message: logoutSyncState.message,
      };
    }

    const refreshToken = authStore.getRefreshToken();
    const sessionId = authStore.getSessionId();

    try {
      if (refreshToken && sessionId) {
        await apiClient.post(
          "/auth/logout",
          { refreshToken, sessionId },
          { _skipAuthRefresh: true },
        );
      }
    } catch (error) {
      logger.warn(
        `No se pudo notificar el logout al servidor: ${error.message}`,
      );
    } finally {
      authStore.clearAll();
      apiClient.clearToken();
      trayService.refreshIdentity();
    }

    return {
      success: true,
    };
  });
}

function registerTimerHandlers() {
  ipcMain.handle(IPC_CHANNELS.TIMER_GET_BREAKS, async () => {
    try {
      const [types, current] = await Promise.all([
        apiClient.get("/breaks/types"),
        apiClient.get("/breaks/current"),
      ]);
      timerService.restoreBreak(current.data?.data || null);
      return {
        success: true,
        data: {
          types: types.data?.data || [],
          current: current.data?.data || null,
        },
      };
    } catch (error) {
      return {
        success: false,
        message: error.response?.data?.message || error.message,
      };
    }
  });

  ipcMain.handle(
    IPC_CHANNELS.TIMER_START_BREAK,
    async (_event, payload = {}) => {
      try {
        const input = normalizeBreakPayload(payload);
        return {
          success: true,
          data: await timerService.startBreak(input.typeId, input.notes),
        };
      } catch (error) {
        return {
          success: false,
          message: error.response?.data?.message || error.message,
        };
      }
    },
  );

  ipcMain.handle(IPC_CHANNELS.TIMER_STOP_BREAK, async () => {
    try {
      return { success: true, data: await timerService.stopBreak() };
    } catch (error) {
      return {
        success: false,
        message: error.response?.data?.message || error.message,
      };
    }
  });

  ipcMain.handle(IPC_CHANNELS.TIMER_GET_WORK_OPTIONS, async () => {
    try {
      const [projectsResponse, tasksResponse] = await Promise.all([
        apiClient.get("/projects", { params: { archived: false, limit: 100 } }),
        apiClient.get("/tasks", { params: { status: "active", limit: 100 } }),
      ]);
      return {
        success: true,
        data: {
          projects: projectsResponse.data?.data?.items || [],
          tasks: tasksResponse.data?.data?.items || [],
        },
      };
    } catch (error) {
      return {
        success: false,
        message: error.response?.data?.message || error.message,
      };
    }
  });
  
  ipcMain.handle(IPC_CHANNELS.TIMER_START, async (_event, payload = {}) => {
    try {
      const input = normalizeTimerStartPayload(payload);
      const result = await timerService.start(input.deviceInfo, {
        projectId: input.projectId,
        taskId: input.taskId,
      });

      return {
        success: true,
        data: result,
      };
    } catch (error) {
      logger.error(`Error en TIMER_START: ${error.message}`);

      return {
        success: false,
        message: error.message || "No fue posible iniciar la sesión.",
      };
    }
  });

  ipcMain.handle(IPC_CHANNELS.TIMER_STOP, async (_event, payload = {}) => {
    try {
      const { reason, notes } = normalizeTimerStopPayload(payload);

      const result = await timerService.stop(reason, notes);

      return {
        success: true,
        data: result,
      };
    } catch (error) {
      logger.error(`Error en TIMER_STOP: ${error.message}`);

      return {
        success: false,
        message: error.message || "No fue posible detener la sesión.",
      };
    }
  });

  ipcMain.handle(IPC_CHANNELS.TIMER_GET_STATUS, async () => {
    try {
      return await timerService.getStatus();
    } catch (error) {
      logger.error(`Error en TIMER_GET_STATUS: ${error.message}`);

      return {
        isRunning: false,
        elapsedSeconds: 0,
        error: error.message || "No fue posible consultar el temporizador.",
      };
    }
  });

  ipcMain.handle(IPC_CHANNELS.TIME_GET_TODAY_TOTAL, async () => {
    try {
      const response = await apiClient.get("/sessions/today");

      if (response.data?.success) {
        return {
          success: true,
          data: response.data.data,
        };
      }

      return {
        success: false,
        message:
          response.data?.message || "No fue posible obtener el total del día.",
      };
    } catch (error) {
      logger.error(`Error en TIME_GET_TODAY_TOTAL: ${error.message}`);

      return {
        success: false,
        message:
          error.response?.data?.message ||
          error.message ||
          "No fue posible obtener el total del día.",
      };
    }
  });
}

function registerScreenshotHandlers() {
  screenshotService.onStatusChange((status) => {
    BrowserWindow.getAllWindows().forEach((window) => {
      if (!window.isDestroyed()) {
        window.webContents.send(IPC_CHANNELS.EVENT_SCREENSHOT_UPDATE, status);
      }
    });
  });

  ipcMain.handle(
    IPC_CHANNELS.SCREENSHOT_START,
    async (_event, payload = {}) => {
      try {
        const { intervalMinutes } = normalizeScreenshotStartPayload(payload);

        return screenshotService.start(intervalMinutes);
      } catch (error) {
        logger.error(`Error en SCREENSHOT_START: ${error.message}`);

        return {
          success: false,
          message: error.message || "No fue posible iniciar las capturas.",
        };
      }
    },
  );

  ipcMain.handle(IPC_CHANNELS.SCREENSHOT_STOP, async () => {
    try {
      return screenshotService.stop();
    } catch (error) {
      logger.error(`Error en SCREENSHOT_STOP: ${error.message}`);

      return {
        success: false,
        message: error.message || "No fue posible detener las capturas.",
      };
    }
  });

  ipcMain.handle(IPC_CHANNELS.SCREENSHOT_GET_STATUS, async () => {
    try {
      return screenshotService.getStatus();
    } catch (error) {
      logger.error(`Error en SCREENSHOT_GET_STATUS: ${error.message}`);

      return {
        success: false,
        message:
          error.message ||
          "No fue posible consultar el estado de las capturas.",
      };
    }
  });

  ipcMain.handle(IPC_CHANNELS.SCREENSHOT_TAKE_MANUAL, async () => {
    try {
      return await screenshotService.takeManualScreenshot();
    } catch (error) {
      logger.error(`Error en SCREENSHOT_TAKE_MANUAL: ${error.message}`);

      return {
        success: false,
        message: error.message || "No fue posible tomar la captura.",
      };
    }
  });

  ipcMain.handle(IPC_CHANNELS.SCREENSHOT_PROCESS_QUEUE, async () => {
    try {
      await screenshotService.processQueue();

      return {
        success: true,
      };
    } catch (error) {
      logger.error(`Error en SCREENSHOT_PROCESS_QUEUE: ${error.message}`);

      return {
        success: false,
        message:
          error.message || "No fue posible procesar la cola de capturas.",
      };
    }
  });
}

function validateExternalUrl(value) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("No se recibió un enlace válido.");
  }

  const url = new URL(value.trim());

  if (url.protocol !== "https:") {
    throw new Error("Solo se permiten enlaces HTTPS.");
  }

  if (!ALLOWED_EXTERNAL_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error("El dominio solicitado no está permitido.");
  }

  return url.toString();
}
