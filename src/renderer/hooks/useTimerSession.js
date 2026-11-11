import { useCallback, useEffect, useRef, useState } from "react";
import { getRendererErrorMessage, reportRendererError } from "../utils/rendererError.js";

export const INITIAL_ACTIVITY_STATUS = {
  percentage: 0,
  status: "idle",
  activeWindow: "Esperando actividad...",
};

export default function useTimerSession({
  apiAvailable,
  clearTransientStates,
  commitClosedSession,
  electronAPI,
  loadTodayTotal,
  mountedRef,
  operationRef,
  projectId,
  setActiveBreak,
  setActivityStatus,
  taskId,
}) {
  const [isRunning, setIsRunning] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [pendingAction, setPendingAction] = useState("");
  const [error, setError] = useState("");
  const [lastResult, setLastResult] = useState(null);
  const sessionClosingRef = useRef(false);
  const activeSessionRef = useRef(null);
  const closedSessionsRef = useRef(new Set());
  const elapsedRef = useRef(0);

  const setObservedElapsed = useCallback((value, { allowDecrease = true } = {}) => {
    // Display only whole seconds confirmed by the main process. Never invent
    // elapsed seconds between samples: that can run ahead of the persisted stop.
    const seconds = reconcileObservedElapsed(elapsedRef.current, value, allowDecrease);
    elapsedRef.current = seconds;
    setElapsedSeconds(seconds);
  }, []);

  useEffect(() => {
    if (!apiAvailable) {
      setError("No fue posible comunicarse con el proceso principal de la aplicación.");
      setIsLoading(false);
      return undefined;
    }

    let active = true;

    const loadInitialStatus = async () => {
      setIsLoading(true);
      setPendingAction("loading");
      setError("");

      try {
        const status = await electronAPI.getTimerStatus();
        if (!active) return;

        activeSessionRef.current = status?.trackingId || status?.sessionId || null;
        setIsRunning(Boolean(status?.isRunning));
        setObservedElapsed(status?.elapsedSeconds);
        await loadTodayTotal();
      } catch (loadError) {
        reportRendererError("Error cargando estado inicial", loadError);
        if (active) {
          setError(
            getRendererErrorMessage(loadError, "No se pudo cargar el estado del temporizador."),
          );
        }
      } finally {
        if (active) {
          setIsLoading(false);
          setPendingAction("");
        }
      }
    };

    loadInitialStatus();
    return () => {
      active = false;
    };
  }, [apiAvailable, electronAPI, loadTodayTotal, setObservedElapsed]);

  useEffect(() => {
    if (!apiAvailable) return undefined;

    return electronAPI.events.onSessionClosed((data = {}) => {
      if (!mountedRef.current) return;

      if (data.sessionId && closedSessionsRef.current.has(data.sessionId)) return;
      if (data.sessionId && activeSessionRef.current && data.sessionId !== activeSessionRef.current) return;
      if (data.sessionId) closedSessionsRef.current.add(data.sessionId);
      activeSessionRef.current = null;
      sessionClosingRef.current = false;
      operationRef.current = "";
      commitClosedSession(data.durationSeconds ?? data.duration);
      setIsRunning(false);
      if (data.reason !== "break") setActiveBreak(null);
      setObservedElapsed(0);
      setIsLoading(false);
      setPendingAction("");
      clearTransientStates();
      setActivityStatus(INITIAL_ACTIVITY_STATUS);
      setLastResult({
        sessionId: data.sessionId,
        queuedForSync: Boolean(data.queuedForSync),
        durationFormatted: data.durationFormatted || formatTime(data.durationSeconds),
        reason: data.reason || "manual",
        message: data.message || "Sesión guardada correctamente.",
      });
      if (!data.queuedForSync) {
        void loadTodayTotal();
      }
    });
  }, [
    apiAvailable,
    clearTransientStates,
    commitClosedSession,
    electronAPI,
    loadTodayTotal,
    mountedRef,
    operationRef,
    setActiveBreak,
    setActivityStatus,
    setObservedElapsed,
  ]);

  useEffect(() => {
    if (!apiAvailable) return undefined;
    return electronAPI.events.onTimerUpdate((data = {}) => {
      if (!mountedRef.current) return;
      if (data.refreshTodayTotal === true) void loadTodayTotal();
      if (!shouldAcceptTimerUpdate({ closing: sessionClosingRef.current, activeId: activeSessionRef.current, starting: operationRef.current === 'start' }, data)) return;
      setIsRunning(Boolean(data.isRunning));
      setObservedElapsed(data.elapsedSeconds, {
        allowDecrease: !data.isRunning,
      });

    });
  }, [apiAvailable, electronAPI, loadTodayTotal, mountedRef, setObservedElapsed]);

  useEffect(() => {
    if (!apiAvailable || !electronAPI.events.onSessionSynced) return undefined;
    return electronAPI.events.onSessionSynced(data => {
      if (!mountedRef.current) return;
      setLastResult(current => current?.sessionId === data.sessionId ? {
        ...current, queuedForSync: false, adjusted: data.adjusted,
        durationFormatted: formatTime(data.duration),
        message: data.adjusted
          ? 'El servidor ajustó la duración por ' + ({ timeout: 'cierre por falta de conexión', inactivity: 'inactividad', new_session: 'inicio en otro equipo', manual: 'cierre manual', system: 'cierre del sistema' }[data.reason] || 'un cierre remoto') + '.'
          : current.message,
      } : current);
      void loadTodayTotal();
    });
  }, [apiAvailable, electronAPI, loadTodayTotal, mountedRef]);

  const start = useCallback(async () => {
    if (operationRef.current || isLoading || isRunning || !apiAvailable) return;

    operationRef.current = "start";
    setIsLoading(true);
    setPendingAction("start");
    setError("");
    setLastResult(null);
    clearTransientStates();
    setActivityStatus(INITIAL_ACTIVITY_STATUS);
    setObservedElapsed(0);

    try {
      const result = await electronAPI.startTimer({
        projectId: projectId || null,
        taskId: taskId || null,
      });
      if (!result?.success) {
        throw new Error(result?.message || "No se pudo iniciar la sesión.");
      }
      if (!mountedRef.current) return;
      if (closedSessionsRef.current.has(result?.data?.sessionId)) return;
      activeSessionRef.current = result?.data?.trackingId || result?.data?.sessionId || null;
      setObservedElapsed(result?.data?.elapsedSeconds, { allowDecrease: false });
      setIsRunning(true);
    } catch (startError) {
      reportRendererError("Error iniciando temporizador", startError);
      setIsRunning(false);
      setObservedElapsed(0);
      setError(getRendererErrorMessage(startError, "No fue posible iniciar la jornada."));
    } finally {
      operationRef.current = "";
      if (mountedRef.current) {
        setIsLoading(false);
        setPendingAction("");
      }
    }
  }, [
    apiAvailable,
    clearTransientStates,
    electronAPI,
    isLoading,
    isRunning,
    mountedRef,
    operationRef,
    projectId,
    setActivityStatus,
    setObservedElapsed,
    taskId,
  ]);

  const stop = useCallback(async () => {
    if (
      operationRef.current ||
      isLoading ||
      !isRunning ||
      !apiAvailable ||
      sessionClosingRef.current
    ) {
      return;
    }

    sessionClosingRef.current = true;
    operationRef.current = "stop";
    setIsLoading(true);
    setPendingAction("stop");
    setError("");
    setIsRunning(false);

    try {
      const result = await electronAPI.stopTimer({ reason: "manual", notes: "" });
      if (!result?.success) {
        throw new Error(result?.message || "No se pudo detener la sesión.");
      }
      // La interfaz espera event:session-closed antes de marcar la sesión como cerrada.
    } catch (stopError) {
      sessionClosingRef.current = false;
      operationRef.current = "";
      reportRendererError("Error deteniendo temporizador", stopError);
      setObservedElapsed(elapsedRef.current);
      setIsRunning(true);
      setError(getRendererErrorMessage(stopError, "No fue posible detener la jornada."));
      if (mountedRef.current) {
        setIsLoading(false);
        setPendingAction("");
      }
    }
  }, [apiAvailable, electronAPI, isLoading, isRunning, mountedRef, operationRef, setObservedElapsed]);

  return {
    elapsedSeconds,
    error,
    isLoading,
    isRunning,
    lastResult,
    pendingAction,
    setError,
    setIsLoading,
    setPendingAction,
    start,
    stop,
  };
}

export function reconcileObservedElapsed(currentValue, reportedValue, allowDecrease = true) {
  const currentSeconds = normalizeSeconds(currentValue);
  const reportedSeconds = normalizeSeconds(reportedValue);
  return allowDecrease ? reportedSeconds : Math.max(currentSeconds, reportedSeconds);
}

function normalizeSeconds(value) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? Math.max(0, Math.floor(numericValue)) : 0;
}

function formatTime(seconds) {
  const safeSeconds = normalizeSeconds(seconds);
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const remainingSeconds = safeSeconds % 60;
  return [hours, minutes, remainingSeconds]
    .map((value) => String(value).padStart(2, "0"))
    .join(":");
}

export function shouldAcceptTimerUpdate({ closing, activeId, starting }, data) {
  if (closing) return false;
  if (!activeId && !starting) return false;
  const id = data.trackingId || data.sessionId;
  return !activeId || !id || activeId === id;
}
