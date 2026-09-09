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
  setSyncStatus,
  taskId,
}) {
  const [isRunning, setIsRunning] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [pendingAction, setPendingAction] = useState("");
  const [error, setError] = useState("");
  const [lastResult, setLastResult] = useState(null);
  const sessionClosingRef = useRef(false);

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

        setIsRunning(Boolean(status?.isRunning));
        setElapsedSeconds(normalizeSeconds(status?.elapsedSeconds));
        if (status?.sync) setSyncStatus(status.sync);
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
  }, [apiAvailable, electronAPI, loadTodayTotal, setSyncStatus]);

  useEffect(() => {
    if (!apiAvailable) return undefined;

    return electronAPI.events.onSessionClosed((data = {}) => {
      if (!mountedRef.current) return;

      sessionClosingRef.current = false;
      operationRef.current = "";
      commitClosedSession(data.durationSeconds ?? data.duration);
      setIsRunning(false);
      setActiveBreak(null);
      setElapsedSeconds(0);
      setIsLoading(false);
      setPendingAction("");
      clearTransientStates();
      setActivityStatus(INITIAL_ACTIVITY_STATUS);
      setLastResult({
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
  ]);

  useEffect(() => {
    if (!apiAvailable) return undefined;
    return electronAPI.events.onTimerUpdate((data = {}) => {
      if (!mountedRef.current) return;
      setIsRunning(Boolean(data.isRunning));
      setElapsedSeconds(normalizeSeconds(data.elapsedSeconds));
      if (data.refreshTodayTotal === true) {
        loadTodayTotal();
      }
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

    try {
      const result = await electronAPI.startTimer({
        projectId: projectId || null,
        taskId: taskId || null,
      });
      if (!result?.success) {
        throw new Error(result?.message || "No se pudo iniciar la sesión.");
      }
      if (!mountedRef.current) return;
      setIsRunning(true);
      setElapsedSeconds(normalizeSeconds(result?.data?.elapsedSeconds));
    } catch (startError) {
      reportRendererError("Error iniciando temporizador", startError);
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
      setError(getRendererErrorMessage(stopError, "No fue posible detener la jornada."));
      if (mountedRef.current) {
        setIsLoading(false);
        setPendingAction("");
      }
    }
  }, [apiAvailable, electronAPI, isLoading, isRunning, mountedRef, operationRef]);

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
