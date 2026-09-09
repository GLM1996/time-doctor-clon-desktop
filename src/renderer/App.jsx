import React, { useCallback, useEffect, useMemo, useState } from "react";
import { runSingleFlight } from "./utils/singleFlight.js";
import { getRendererErrorMessage, reportRendererError } from "./utils/rendererError.js";

import {
  AlertCircle,
  Clock3,
  ExternalLink,
  LayoutDashboard,
  Loader2,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Power,
  Settings,
  UserRound,
} from "lucide-react";

import StatusBadge from "./components/StatusBadge.jsx";

const Login = React.lazy(() => import("./pages/Login.jsx"));
const Timer = React.lazy(() => import("./components/Timer.jsx"));

const DEFAULT_APP_VERSION = "1.0.0";

const WEB_APP_URL = "https://logyourtime.com";

const MENU_ITEMS = [
  {
    id: "timer",
    label: "Control de tiempo",
    description: "Iniciar y pausar la jornada",
    icon: Clock3,
    type: "internal",
  },
  {
    id: "web",
    label: "Abrir plataforma web",
    description: "Consultar reportes y actividad",
    icon: LayoutDashboard,
    type: "external",
  },
  {
    id: "preferences",
    label: "Preferencias",
    description: "Inicio y comportamiento",
    icon: Settings,
    type: "internal",
  },
];

function App() {
  const electronAPI = window.electronAPI;

  const [isAuthenticated, setIsAuthenticated] = useState(null);

  const [user, setUser] = useState(null);

  const [isConnected, setIsConnected] = useState(null);

  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const [isOpeningWeb, setIsOpeningWeb] = useState(false);

  const [isQuitting, setIsQuitting] = useState(false);

  const [authError, setAuthError] = useState("");

  const [appVersion, setAppVersion] = useState(DEFAULT_APP_VERSION);

  const [activeView, setActiveView] = useState("timer");

  const [sidebarExpanded, setSidebarExpanded] = useState(false);

  const apiAvailable = Boolean(
    electronAPI && typeof electronAPI.getAuthStatus === "function",
  );

  const userName = useMemo(() => {
    const firstName = user?.firstName?.trim();

    if (firstName) {
      return firstName;
    }

    const emailName = user?.email?.split("@")[0]?.trim();

    return emailName || "Usuario";
  }, [user]);

  const userInitials = useMemo(() => {
    const firstInitial = user?.firstName?.trim().charAt(0).toUpperCase() || "";

    const lastInitial = user?.lastName?.trim().charAt(0).toUpperCase() || "";

    return `${firstInitial}${lastInitial}` || "U";
  }, [user]);

  const loadAuthStatus = useCallback(async (isActive = () => true) => {
    if (!apiAvailable) {
      setAuthError(
        "No fue posible comunicarse con el proceso principal de la aplicación.",
      );

      setIsAuthenticated(false);
      setUser(null);
      setIsConnected(false);

      return;
    }

    setAuthError("");

    try {
      const status = await runSingleFlight("auth-status", () => electronAPI.getAuthStatus());
      if (!isActive()) return;

      const authenticated = Boolean(status?.isAuthenticated && status?.user);

      setIsAuthenticated(authenticated);

      setUser(authenticated ? status.user : null);

      if (typeof status?.connected === "boolean") {
        setIsConnected(status.connected);
      }
    } catch (error) {
      if (!isActive()) return;
      reportRendererError("Error verificando autenticación", error);

      setAuthError(
        getRendererErrorMessage(error, "No fue posible verificar la sesión."),
      );

      setIsAuthenticated(false);
      setUser(null);
      setIsConnected(false);
    }
  }, [apiAvailable, electronAPI]);

  useEffect(() => {
    let active = true;
    loadAuthStatus(() => active);
    return () => {
      active = false;
    };
  }, [loadAuthStatus]);

  useEffect(() => {
    if (typeof electronAPI?.reportConnectionStatus !== "function") {
      return undefined;
    }

    const report = () => {
      electronAPI.reportConnectionStatus(window.navigator.onLine);
    };
    const handleOffline = () => {
      setIsConnected(false);
      electronAPI.reportConnectionStatus(false);
    };
    const handleOnline = () => {
      electronAPI.reportConnectionStatus(true);
    };

    report();
    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);

    return () => {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
    };
  }, [electronAPI]);

  useEffect(() => {
    if (!electronAPI || typeof electronAPI.getAppVersion !== "function") {
      return undefined;
    }

    let active = true;

    const loadVersion = async () => {
      try {
        const version = await electronAPI.getAppVersion();

        if (active && typeof version === "string" && version.trim()) {
          setAppVersion(version.trim());
        }
      } catch (error) {
        reportRendererError("Error obteniendo versión", error);
      }
    };

    loadVersion();

    return () => {
      active = false;
    };
  }, [electronAPI]);

  useEffect(() => {
    if (typeof electronAPI?.events?.onConnectionStatus !== "function") {
      return undefined;
    }

    const unsubscribe = electronAPI.events.onConnectionStatus(
      (data = {}) => {
        setIsConnected(Boolean(data.connected ?? data.isConnected));
      },
    );

    return () => {
      unsubscribe?.();
    };
  }, [electronAPI]);

  useEffect(() => {
    if (typeof electronAPI?.events?.onAuthExpired !== "function") {
      return undefined;
    }

    const unsubscribe = electronAPI.events.onAuthExpired((data = {}) => {
      setUser(null);
      setIsAuthenticated(false);

      setAuthError(
        getRendererErrorMessage(
          { message: data.message },
          "Tu sesión expiró. Inicia sesión nuevamente.",
        ),
      );
    });

    return () => {
      unsubscribe?.();
    };
  }, [electronAPI]);

  const handleLoginSuccess = (userData) => {
    if (!userData) {
      setAuthError("No se recibió la información del usuario.");

      setIsAuthenticated(false);

      return;
    }

    setUser(userData);
    setIsAuthenticated(true);
    setIsConnected(true);
    setAuthError("");
    setActiveView("timer");
  };

  const handleLogout = async () => {
    if (isLoggingOut || !apiAvailable) {
      return;
    }

    setIsLoggingOut(true);
    setAuthError("");

    try {
      const result = await electronAPI.logout();

      if (result?.success === false) {
        throw new Error(result.message || "No fue posible cerrar la sesión.");
      }

      setUser(null);
      setIsAuthenticated(false);
      setActiveView("timer");
    } catch (error) {
      reportRendererError("Error cerrando sesión", error);

      setAuthError(
        getRendererErrorMessage(error, "No fue posible cerrar la sesión."),
      );
    } finally {
      setIsLoggingOut(false);
    }
  };

  const handleOpenWeb = async () => {
    if (isOpeningWeb) {
      return;
    }

    setIsOpeningWeb(true);
    setAuthError("");

    try {
      /*
       * Primera opción: función directa expuesta
       * por el preload.
       */
      if (typeof electronAPI?.openExternal === "function") {
        const result = await electronAPI.openExternal(WEB_APP_URL);

        if (result?.success === false) {
          throw new Error(
            result.message || "No fue posible abrir la plataforma web.",
          );
        }

        return;
      }

      /*
       * Segunda opción: canal IPC genérico.
       */
      throw new Error(
        "La función para abrir enlaces externos no está disponible.",
      );
    } catch (error) {
      reportRendererError("Error abriendo plataforma web", error);

      setAuthError(
        getRendererErrorMessage(
          error,
          "No fue posible abrir la plataforma web.",
        ),
      );
    } finally {
      setIsOpeningWeb(false);
    }
  };

  const handleQuitApp = () => {
    if (isQuitting) {
      return;
    }

    const confirmed = window.confirm(
      "¿Estás seguro de que deseas cerrar LogYourTime por completo?",
    );

    if (!confirmed) {
      return;
    }

    if (typeof window.electronAPI?.quitApp !== "function") {
      setAuthError("La función para cerrar la aplicación no está disponible.");

      return;
    }

    setIsQuitting(true);

    const sent = window.electronAPI.quitApp();

    if (!sent) {
      setIsQuitting(false);

      setAuthError("No fue posible solicitar el cierre de la aplicación.");
    }
  };

  const handleMenuItemClick = (menuItem) => {
    if (menuItem.type === "external") {
      handleOpenWeb();
      return;
    }

    setActiveView(menuItem.id);
  };

  if (isAuthenticated === null) {
    return <ApplicationLoading appVersion={appVersion} />;
  }

  if (!isAuthenticated) {
    return (
      <div className="relative min-h-screen">
        <React.Suspense fallback={<ApplicationLoading appVersion={appVersion} />}>
          <Login onLoginSuccess={handleLoginSuccess} appVersion={appVersion} />
        </React.Suspense>

        {authError && (
          <FloatingError message={authError} onClose={() => setAuthError("")} />
        )}
      </div>
    );
  }

  return (
    <div className="flex h-screen min-h-0 flex-col overflow-hidden bg-[#292b26]">
      <TopHeader
        user={user}
        userName={userName}
        userInitials={userInitials}
        connected={isConnected}
        isLoggingOut={isLoggingOut}
        onLogout={handleLogout}
      />

      <div className="flex min-h-0 flex-1">
        <Sidebar
          expanded={sidebarExpanded}
          activeView={activeView}
          isOpeningWeb={isOpeningWeb}
          isQuitting={isQuitting}
          onToggle={() => setSidebarExpanded((currentValue) => !currentValue)}
          onItemClick={handleMenuItemClick}
          onQuit={handleQuitApp}
        />

        <main className="min-h-0 min-w-0 flex-1 overflow-hidden bg-[#f4f1e9]">
          {authError && (
            <div
              role="alert"
              className="mx-4 mt-4 flex items-start gap-2.5 rounded-xl border border-[#ddb0a1] bg-[#f5e4df] px-3.5 py-3"
            >
              <AlertCircle
                className="mt-0.5 h-4 w-4 shrink-0 text-[#a05243]"
                strokeWidth={1.8}
                aria-hidden="true"
              />

              <p className="min-w-0 flex-1 text-[10px] leading-4 text-[#98483a]">
                {authError}
              </p>

              <button
                type="button"
                onClick={() => setAuthError("")}
                className="text-[10px] font-semibold text-[#873e33] hover:underline"
              >
                Cerrar
              </button>
            </div>
          )}

          <ViewContent activeView={activeView} />
        </main>
      </div>

      <footer className="flex h-7 shrink-0 items-center justify-between border-t border-[#45483f] bg-[#22241f] px-3 text-[9px] text-[#bdb9ae]">
        <span className="truncate">{user?.email || "Usuario autenticado"}</span>

        <span className="shrink-0">LogYourTime v{appVersion}</span>
      </footer>
    </div>
  );
}

function TopHeader({
  user,
  userName,
  userInitials,
  connected,
  isLoggingOut,
  onLogout,
}) {
  return (
    <header className="flex h-16 shrink-0 items-center justify-between border-b border-[#45483f] bg-[#292b26] px-3 sm:px-4">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#d8b98c] bg-[#ead7bb] text-[#76501f]">
          <Clock3 className="h-5 w-5" strokeWidth={1.8} aria-hidden="true" />
        </div>

        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold tracking-[-0.02em] text-[#f7f3ea]">
            LogYourTime
          </h1>

          <p
            className="mt-0.5 max-w-52 truncate text-[10px] text-[#bdb9ae]"
            title={user?.organization?.name || "Control de jornada laboral"}
          >
            {user?.organization?.name || "Control de jornada laboral"}
          </p>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <StatusBadge connected={connected} />

        <div className="hidden h-8 w-px bg-[#45483f] sm:block" />

        <div className="hidden min-w-0 items-center gap-2 sm:flex">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#d8b98c] bg-[#ead7bb] text-[10px] font-semibold text-[#76501f]">
            {userInitials}
          </div>

          <div className="min-w-0">
            <p className="max-w-28 truncate text-[10px] font-semibold text-[#f7f3ea]">
              {userName}
            </p>

            <p className="max-w-28 truncate text-[9px] text-[#aaa69c]">
              {user?.email}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onLogout}
          disabled={isLoggingOut}
          title="Cerrar sesión"
          aria-label="Cerrar sesión"
          className="flex h-9 w-9 items-center justify-center rounded-xl border border-[#5c4942] bg-[#3b2d29] text-[#e7b5aa] transition-colors hover:bg-[#513630] hover:text-[#ffd5cb] focus:outline-none focus:ring-4 focus:ring-[#a95444]/15 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isLoggingOut ? (
            <Loader2
              className="h-4 w-4 animate-spin"
              strokeWidth={1.8}
              aria-hidden="true"
            />
          ) : (
            <LogOut className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
          )}
        </button>
      </div>
    </header>
  );
}

function Sidebar({
  expanded,
  activeView,
  isOpeningWeb,
  isQuitting,
  onToggle,
  onItemClick,
  onQuit,
}) {
  return (
    <aside
      className={`flex shrink-0 flex-col border-r border-[#45483f] bg-[#252722] transition-[width] duration-200 ${
        expanded ? "w-48" : "w-16"
      }`}
    >
      <div className="flex h-12 shrink-0 items-center justify-center border-b border-[#45483f]">
        <button
          type="button"
          onClick={onToggle}
          title={expanded ? "Contraer menú" : "Expandir menú"}
          aria-label={
            expanded ? "Contraer menú lateral" : "Expandir menú lateral"
          }
          className={`flex h-9 items-center rounded-xl text-[#bdb9ae] transition-colors hover:bg-[#363832] hover:text-[#f7f3ea] focus:outline-none focus:ring-4 focus:ring-[#94602a]/15 ${
            expanded
              ? "w-[calc(100%-1rem)] justify-start gap-3 px-3"
              : "w-9 justify-center"
          }`}
        >
          {expanded ? (
            <PanelLeftClose
              className="h-4 w-4 shrink-0"
              strokeWidth={1.8}
              aria-hidden="true"
            />
          ) : (
            <PanelLeftOpen
              className="h-4 w-4"
              strokeWidth={1.8}
              aria-hidden="true"
            />
          )}

          {expanded && (
            <span className="truncate text-[10px] font-semibold">
              Contraer menú
            </span>
          )}
        </button>
      </div>

      <nav
        className="flex flex-1 flex-col gap-1.5 p-2"
        aria-label="Menú principal"
      >
        {MENU_ITEMS.map((menuItem) => (
          <SidebarItem
            key={menuItem.id}
            item={menuItem}
            expanded={expanded}
            active={menuItem.type === "internal" && activeView === menuItem.id}
            loading={menuItem.id === "web" && isOpeningWeb}
            onClick={() => onItemClick(menuItem)}
          />
        ))}
      </nav>

      <div className="border-t border-[#45483f] p-2">
        <button
          type="button"
          onClick={onQuit}
          disabled={isQuitting}
          title="Cerrar aplicación"
          aria-label="Cerrar aplicación por completo"
          className={`flex h-10 w-full items-center rounded-xl text-[#d79789] transition-colors hover:bg-[#47302b] hover:text-[#ffd5cb] focus:outline-none focus:ring-4 focus:ring-[#a95444]/15 disabled:cursor-not-allowed disabled:opacity-50 ${
            expanded ? "justify-start gap-3 px-3" : "justify-center"
          }`}
        >
          {isQuitting ? (
            <Loader2
              className="h-4 w-4 shrink-0 animate-spin"
              strokeWidth={1.8}
              aria-hidden="true"
            />
          ) : (
            <Power
              className="h-4 w-4 shrink-0"
              strokeWidth={1.8}
              aria-hidden="true"
            />
          )}

          {expanded && (
            <span className="truncate text-[10px] font-semibold">
              Cerrar aplicación
            </span>
          )}
        </button>
      </div>
    </aside>
  );
}

function SidebarItem({ item, expanded, active, loading, onClick }) {
  const Icon = item.icon;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      title={expanded ? undefined : item.label}
      className={`group flex min-h-11 w-full items-center rounded-xl transition-colors focus:outline-none focus:ring-4 focus:ring-[#94602a]/15 disabled:cursor-not-allowed disabled:opacity-60 ${
        expanded ? "justify-start gap-3 px-3" : "justify-center"
      } ${
        active
          ? "bg-[#ead7bb] text-[#76501f]"
          : "text-[#bdb9ae] hover:bg-[#363832] hover:text-[#f7f3ea]"
      }`}
    >
      {loading ? (
        <Loader2
          className="h-4 w-4 shrink-0 animate-spin"
          strokeWidth={1.8}
          aria-hidden="true"
        />
      ) : (
        <Icon
          className="h-4 w-4 shrink-0"
          strokeWidth={1.8}
          aria-hidden="true"
        />
      )}

      {expanded && (
        <span className="min-w-0 flex-1 text-left">
          <span className="block truncate text-[10px] font-semibold">
            {item.label}
          </span>

          <span
            className={`mt-0.5 block truncate text-[8px] ${
              active
                ? "text-[#8b653d]"
                : "text-[#8f9089] group-hover:text-[#bdb9ae]"
            }`}
          >
            {item.description}
          </span>
        </span>
      )}

      {expanded && item.type === "external" && (
        <ExternalLink
          className="h-3 w-3 shrink-0"
          strokeWidth={1.8}
          aria-hidden="true"
        />
      )}
    </button>
  );
}

function ViewContent({ activeView }) {
  if (activeView === "timer") {
    return (
      <div className="flex h-full min-h-0 items-center justify-center overflow-y-auto p-4">
        <React.Suspense fallback={<ViewLoading />}>
          <Timer />
        </React.Suspense>
      </div>
    );
  }

  if (activeView === "preferences") {
    return <PreferencesView />;
  }

  return (
    <div className="flex h-full items-center justify-center p-6 text-center">
      <p className="text-sm text-[#777970]">Vista no disponible.</p>
    </div>
  );
}

function PreferencesView() {
  const electronAPI = window.electronAPI;
  const [enabled, setEnabled] = useState(true);
  const [supported, setSupported] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    electronAPI.getStartupSetting()
      .then((result) => {
        if (!active) return;
        setEnabled(result?.enabled !== false);
        setSupported(result?.supported !== false);
      })
      .catch((error) => {
        if (active) setMessage(getRendererErrorMessage(error, "No se pudo cargar la preferencia."));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [electronAPI]);

  const changeStartup = async () => {
    const nextValue = !enabled;
    setSaving(true);
    setMessage("");
    try {
      const result = await electronAPI.setStartupSetting(nextValue);
      setEnabled(result?.enabled ?? nextValue);
      setSupported(result?.supported !== false);
      setMessage(nextValue
        ? "LogYourTime se iniciará automáticamente con Windows."
        : "LogYourTime ya no se iniciará automáticamente con Windows.");
    } catch (error) {
      setMessage(getRendererErrorMessage(error, "No se pudo guardar la preferencia."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto p-4 sm:p-6">
      <section className="mx-auto max-w-2xl overflow-hidden rounded-[22px] border border-[#ded9cd] bg-[#fbf9f4] shadow-[0_18px_45px_rgba(40,37,31,0.12)]">
        <header className="border-b border-[#e3ded4] px-5 py-5 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-[#d8b98c] bg-[#ead7bb] text-[#76501f]">
              <Settings className="h-5 w-5" strokeWidth={1.8} aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-[#30332c]">Preferencias de la aplicación</h2>
              <p className="mt-0.5 text-xs text-[#777970]">Configura cómo se comporta LogYourTime en este equipo.</p>
            </div>
          </div>
        </header>

        <div className="p-5 sm:p-6">
          <div className="flex items-start justify-between gap-5 rounded-2xl border border-[#ded9cd] bg-white px-4 py-4">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-[#3f423b]">Iniciar con Windows</p>
              <p className="mt-1 max-w-md text-xs leading-5 text-[#777970]">Abre LogYourTime automáticamente cuando inicies sesión en Windows. Esta opción está activada por defecto.</p>
              {!supported && !loading && <p className="mt-2 text-[10px] font-medium text-[#986126]">El cambio se aplicará cuando uses la versión instalada en Windows.</p>}
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={enabled}
              aria-label="Iniciar LogYourTime con Windows"
              onClick={changeStartup}
              disabled={loading || saving}
              className={`relative mt-0.5 h-7 w-12 shrink-0 rounded-full border transition-colors focus:outline-none focus:ring-4 focus:ring-[#94602a]/15 disabled:cursor-wait disabled:opacity-60 ${enabled ? "border-[#617258] bg-[#6f8064]" : "border-[#aaa9a2] bg-[#b8b7b0]"}`}
            >
              <span className={`absolute left-1 top-1 h-[18px] w-[18px] rounded-full bg-white shadow-[0_1px_4px_rgba(35,36,31,0.3)] transition-transform duration-200 ${enabled ? "translate-x-5" : "translate-x-0"}`} />
            </button>
          </div>

          {message && <p className="mt-4 rounded-xl border border-[#dfd5c6] bg-[#f5f1e9] px-4 py-3 text-xs text-[#62655d]">{message}</p>}
        </div>
      </section>
    </div>
  );
}

function ViewLoading() {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-[#ded9cd] bg-[#fbf9f4] px-4 py-3 text-xs text-[#686a63]" role="status">
      <Loader2 className="h-4 w-4 animate-spin text-[#986126]" strokeWidth={1.8} aria-hidden="true" />
      Cargando control de tiempo...
    </div>
  );
}

function ApplicationLoading({ appVersion }) {
  return (
    <main
      className="flex min-h-screen items-center justify-center bg-[#292b26] p-4"
      role="status"
      aria-label="Cargando aplicación"
    >
      <section className="w-full max-w-xs rounded-[22px] border border-[#45483f] bg-[#fbf9f4] px-6 py-8 text-center shadow-[0_28px_80px_rgba(16,17,14,0.4)]">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-[#d8b98c] bg-[#ead7bb] text-[#76501f]">
          <Clock3 className="h-7 w-7" strokeWidth={1.8} aria-hidden="true" />
        </div>

        <h1 className="mt-4 text-lg font-semibold tracking-[-0.03em] text-[#30332c]">
          LogYourTime
        </h1>

        <div className="mt-5 flex items-center justify-center gap-2 text-xs text-[#777970]">
          <Loader2
            className="h-4 w-4 animate-spin text-[#986126]"
            strokeWidth={1.8}
            aria-hidden="true"
          />
          Verificando sesión...
        </div>

        <p className="mt-5 text-[9px] font-medium tracking-wide text-[#999b93]">
          LogYourTime v{appVersion}
        </p>
      </section>
    </main>
  );
}

function FloatingError({ message, onClose }) {
  return (
    <div className="fixed bottom-4 left-1/2 z-50 flex w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 items-start gap-2.5 rounded-xl border border-[#ddb0a1] bg-[#f5e4df] px-4 py-3 shadow-[0_12px_35px_rgba(70,37,31,0.18)]">
      <AlertCircle
        className="mt-0.5 h-4 w-4 shrink-0 text-[#a05243]"
        strokeWidth={1.8}
        aria-hidden="true"
      />

      <p className="min-w-0 flex-1 text-[10px] leading-4 text-[#98483a]">
        {message}
      </p>

      <button
        type="button"
        onClick={onClose}
        className="text-[10px] font-semibold text-[#873e33] hover:underline"
      >
        Cerrar
      </button>
    </div>
  );
}

export default App;
