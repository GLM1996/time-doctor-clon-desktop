import { safeStorage } from 'electron';
import Store from 'electron-store';
import { createResilientElectronStore } from './resilientElectronStore.js';
import { parseStoredUser, serializeStoredUser } from './storedUserPolicy.js';

const ENCRYPTED_PREFIX = 'safe:';
const LEGACY_ENCRYPTION_KEY = 'una-clave-secreta-para-encriptar-el-store';

const store = createResilientElectronStore({
  name: 'user-data-v2',
  schema: {
    token: { type: 'string', default: '' },
    refreshToken: { type: 'string', default: '' },
    sessionId: { type: 'string', default: '' },
    user: { type: 'object', default: {} },
    protectedUser: { type: 'string', default: '' },
    rememberedEmail: { type: 'string', default: '' },
    rememberedPassword: { type: 'string', default: '' },
    settings: { type: 'object', default: {} },
    updateHealth: { type: 'object', default: {} },
  },
});

let legacyMigrationAttempted = false;

function migrateLegacyStore() {
  if (legacyMigrationAttempted) return;
  legacyMigrationAttempted = true;

  try {
    const legacyStore = new Store({
      name: 'user-data',
      encryptionKey: LEGACY_ENCRYPTION_KEY,
    });

    const legacyToken = legacyStore.get('token', '');
    const legacyUser = legacyStore.get('user', {});
    const legacySettings = legacyStore.get('settings', {});

    if (legacyToken && !store.get('token')) {
      const encrypted = encryptToken(legacyToken);
      if (encrypted) store.set('token', encrypted);
    }
    if (
      legacyUser &&
      typeof legacyUser === 'object' &&
      Object.keys(legacyUser).length > 0 &&
      Object.keys(store.get('user')).length === 0
    ) {
      store.set('user', legacyUser);
    }
    if (
      legacySettings &&
      typeof legacySettings === 'object' &&
      Object.keys(legacySettings).length > 0 &&
      Object.keys(store.get('settings')).length === 0
    ) {
      store.set('settings', legacySettings);
    }

    legacyStore.clear();
  } catch {
    // Un archivo heredado ilegible no debe impedir que la aplicación arranque.
  }
}

function encryptToken(token) {
  if (!token || !safeStorage.isEncryptionAvailable()) {
    return '';
  }

  return `${ENCRYPTED_PREFIX}${safeStorage.encryptString(token).toString('base64')}`;
}

function decryptSecret(storedValue, storeKey) {
  if (!storedValue || typeof storedValue !== 'string') return '';

  if (!storedValue.startsWith(ENCRYPTED_PREFIX)) {
    // Migra instalaciones anteriores que guardaban secretos en texto plano.
    const encrypted = encryptToken(storedValue);
    if (encrypted) {
      store.set(storeKey, encrypted);
      return storedValue;
    }
    store.delete(storeKey);
    return '';
  }

  try {
    const encryptedBuffer = Buffer.from(
      storedValue.slice(ENCRYPTED_PREFIX.length),
      'base64',
    );
    return safeStorage.decryptString(encryptedBuffer);
  } catch {
    store.delete(storeKey);
    return '';
  }
}

export const authStore = {
  getToken: () => {
    migrateLegacyStore();
    return decryptSecret(store.get('token'), 'token');
  },
  setToken: (token) => {
    const encrypted = encryptToken(token);
    if (!encrypted) {
      store.delete('token');
      return false;
    }
    store.set('token', encrypted);
    return true;
  },
  clearToken: () => store.delete('token'),

  getRefreshToken: () =>
    decryptSecret(store.get('refreshToken'), 'refreshToken'),
  setRefreshToken: (token) => {
    const encrypted = encryptToken(token);
    if (!encrypted) {
      store.delete('refreshToken');
      return false;
    }
    store.set('refreshToken', encrypted);
    return true;
  },
  clearRefreshToken: () => store.delete('refreshToken'),

  getSessionId: () => decryptSecret(store.get('sessionId', ''), 'sessionId'),
  setSessionId: (sessionId) => {
    const encrypted = encryptToken(sessionId);
    if (!encrypted) {
      store.delete('sessionId');
      return false;
    }
    store.set('sessionId', encrypted);
    return true;
  },
  clearSessionId: () => store.delete('sessionId'),

  getUser: () => {
    migrateLegacyStore();
    const protectedValue = decryptSecret(store.get('protectedUser', ''), 'protectedUser');
    const protectedUser = parseStoredUser(protectedValue);
    if (protectedUser) return protectedUser;

    const legacyUser = store.get('user', {});
    const serialized = serializeStoredUser(legacyUser);
    if (!serialized) return {};
    const encrypted = encryptToken(serialized);
    if (encrypted) {
      store.set('protectedUser', encrypted);
      store.delete('user');
    }
    return legacyUser;
  },
  setUser: (user) => {
    const serialized = serializeStoredUser(user);
    const encrypted = encryptToken(serialized);
    if (!encrypted) {
      store.delete('protectedUser');
      store.delete('user');
      return false;
    }
    store.set('protectedUser', encrypted);
    store.delete('user');
    return true;
  },
  clearUser: () => {
    store.delete('protectedUser');
    store.delete('user');
  },

  clearAll: () => {
    store.delete('token');
    store.delete('refreshToken');
    store.delete('sessionId');
    store.delete('protectedUser');
    store.delete('user');
  },

  isAuthenticated: () => {
    migrateLegacyStore();
    return Boolean(
      decryptSecret(store.get('token'), 'token') ||
      decryptSecret(store.get('refreshToken'), 'refreshToken'),
    );
  },
};

export const credentialStore = {
  get: () => ({
    email: decryptSecret(store.get('rememberedEmail', ''), 'rememberedEmail'),
    password: decryptSecret(store.get('rememberedPassword', ''), 'rememberedPassword'),
  }),
  set: ({ email, password }) => {
    const encryptedEmail = encryptToken(email);
    const encryptedPassword = encryptToken(password);
    if (!encryptedEmail || !encryptedPassword) {
      store.delete('rememberedEmail');
      store.delete('rememberedPassword');
      return false;
    }
    store.set('rememberedEmail', encryptedEmail);
    store.set('rememberedPassword', encryptedPassword);
    return true;
  },
  clear: () => {
    store.delete('rememberedEmail');
    store.delete('rememberedPassword');
  },
};

export const updateHealthStore = {
  get: () => store.get('updateHealth', {}),
  setPending: (data) => store.set('updateHealth', { ...data, status: 'pending', attempts: 0 }),
  recordStartup: (currentVersion) => {
    const state = store.get('updateHealth', {});
    if (!['pending', 'verifying'].includes(state.status)) return state;
    const attempts = Number(state.attempts || 0) + 1;
    const restartedBeforeHealthy = state.status === 'verifying';
    const next = {
      ...state,
      status: state.targetVersion !== currentVersion
        ? 'install-failed'
        : restartedBeforeHealthy
          ? 'recovery-required'
          : 'verifying',
      attempts,
      lastStartupAt: new Date().toISOString(),
    };
    store.set('updateHealth', next);
    return next;
  },
  markHealthy: (currentVersion) => store.set('updateHealth', {
    status: 'healthy',
    currentVersion,
    verifiedAt: new Date().toISOString(),
  }),
  clear: () => store.delete('updateHealth'),
};

export default store;
