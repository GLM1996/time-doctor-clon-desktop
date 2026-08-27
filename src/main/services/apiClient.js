import axios from 'axios';
import { app } from 'electron';
import logger from '../utils/logger.js';
import { authStore } from './store.js';
import { shouldRevokeSessionAfterRefreshError } from './authRefreshPolicy.js';
import { resolveApiBaseUrl } from './apiBaseUrl.js';
import { persistAuthSession } from './authPersistencePolicy.js';
import { revokeRemoteSession } from './remoteSessionCleanup.js';

class ApiClient {
  constructor() {
    this.client = axios.create({
      baseURL: resolveApiBaseUrl(import.meta.env.VITE_API_URL, { isPackaged: app.isPackaged }),
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
        'X-Client-Type': 'desktop',
      }
    });

    this.token = null;
    this.connectionListeners = new Set();
    this.isConnected = null;
    this.refreshPromise = null;
    this.authExpiredListeners = new Set();

    // Interceptor para agregar token
    this.client.interceptors.request.use((config) => {
      if (this.token) {
        config.headers.Authorization = `Bearer ${this.token}`;
      }
      return config;
    });

    // Interceptor para manejar errores
    this.client.interceptors.response.use(
      (response) => {
        this._setConnectionState(true);
        return response;
      },
      async (error) => {
        this._setConnectionState(
          Boolean(error.response),
        );
        if (
          error.response?.status === 401 &&
          !error.config?._skipAuthRefresh &&
          !String(error.config?.url || '').includes('/auth/login')
        ) {
          try {
            const accessToken =
              await this.refreshAccessToken();
            error.config._skipAuthRefresh = true;
            error.config.headers =
              error.config.headers || {};
            error.config.headers.Authorization =
              `Bearer ${accessToken}`;
            return this.client.request(error.config);
          } catch (refreshError) {
            logger.warn(
              `La sesión no pudo renovarse: ${refreshError.message}`,
            );
            if (shouldRevokeSessionAfterRefreshError(refreshError)) {
              authStore.clearToken();
              authStore.clearRefreshToken();
              authStore.clearSessionId();
              this.token = null;
              this._notifyAuthExpired();
            } else {
              return Promise.reject(refreshError);
            }
          }
          logger.warn('Token expirado o inválido');
        }
        return Promise.reject(error);
      }
    );
  }

  setToken(token) {
    this.token = token;
  }

  clearToken() {
    this.token = null;
  }

  getToken() {
    return this.token;
  }

  async refreshAccessToken() {
    if (!this.refreshPromise) {
      const sessionId = authStore.getSessionId();
      const refreshToken = authStore.getRefreshToken();

      if (!sessionId || !refreshToken) {
        throw new Error('No existe un refresh token');
      }

      this.refreshPromise = this.client
        .post(
          '/auth/refresh',
          { sessionId, refreshToken },
          { _skipAuthRefresh: true },
        )
        .then(async (response) => {
          const data = response.data?.data || {};
          if (
            !data.accessToken ||
            !data.refreshToken ||
            !data.sessionId
          ) {
            throw new Error(
              'Respuesta de renovación incompleta',
            );
          }

          if (!persistAuthSession(authStore, data)) {
            this.token = null;
            this._notifyAuthExpired();
            await revokeRemoteSession({
              post: (...args) => this.client.post(...args),
              accessToken: data.accessToken,
              refreshToken: data.refreshToken,
              sessionId: data.sessionId,
              onError: cleanupError => logger.warn(
                `No se pudo revocar la sesion renovada sin persistir: ${cleanupError.message}`,
              ),
            });
            throw new Error('No fue posible proteger la sesión renovada');
          }
          if (data.user) authStore.setUser(data.user);
          this.token = data.accessToken;
          return data.accessToken;
        })
        .finally(() => {
          this.refreshPromise = null;
        });
    }

    return this.refreshPromise;
  }

  onConnectionChange(listener) {
    if (typeof listener !== 'function') return () => {};
    this.connectionListeners.add(listener);
    return () => this.connectionListeners.delete(listener);
  }

  onAuthExpired(listener) {
    if (typeof listener !== 'function') return () => {};
    this.authExpiredListeners.add(listener);
    return () => this.authExpiredListeners.delete(listener);
  }

  _notifyAuthExpired() {
    this.authExpiredListeners.forEach((listener) => {
      try {
        listener();
      } catch (error) {
        logger.warn(`Listener de sesión expirada falló: ${error.message}`);
      }
    });
  }

  getConnectionState() {
    return this.isConnected;
  }

  _setConnectionState(connected) {
    if (this.isConnected === connected) return;
    this.isConnected = connected;
    this.connectionListeners.forEach((listener) => {
      try {
        listener(connected);
      } catch (error) {
        logger.warn(
          `Listener de conexión falló: ${error.message}`,
        );
      }
    });
  }

  // Métodos HTTP
  async get(url, config = {}) {
    return this.client.get(url, config);
  }

  async post(url, data = {}, config = {}) {
    return this.client.post(url, data, config);
  }

  async put(url, data = {}, config = {}) {
    return this.client.put(url, data, config);
  }

  async patch(url, data = {}, config = {}) {
    return this.client.patch(url, data, config);
  }

  async delete(url, config = {}) {
    return this.client.delete(url, config);
  }

  // Verificar conexión
  async healthCheck() {
    try {
      const response = await this.client.get(
        '/health',
        {
          timeout: 5000,
        },
      );
      return response.data.success === true;
    } catch (error) {
      return false;
    }
  }
}

export default new ApiClient();
