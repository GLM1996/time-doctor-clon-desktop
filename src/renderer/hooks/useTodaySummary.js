import { useCallback, useRef, useState } from "react";
import { runSingleFlight } from "../utils/singleFlight.js";
import { reportRendererError } from "../utils/rendererError.js";

export default function useTodaySummary({
  apiAvailable,
  electronAPI,
  mountedRef,
}) {
  const [total, setTotal] = useState(0);
  const [sessionCount, setSessionCount] = useState(0);
  const summaryDateRef = useRef(null);

  const commitClosedSession = useCallback((durationSeconds) => {
    const duration = normalizeNonNegativeInteger(durationSeconds);
    setTotal((current) => current + duration);
    setSessionCount((current) => current + 1);
  }, []);

  const reload = useCallback(async () => {
    if (!apiAvailable) return;

    try {
      const result = await runSingleFlight("today-total", () => electronAPI.getTodayTotal());
      if (!result?.success) {
        throw new Error(result?.message || "No se pudo cargar el total del día.");
      }
      if (!mountedRef.current) return;

      const nextDate = result?.data?.date || null;
      const sameDay = Boolean(nextDate && summaryDateRef.current === nextDate);
      // La interfaz suma el contador vivo por separado. Usar el subtotal cerrado
      // evita duplicar la sesión activa que el backend incluye en totalDuration.
      const nextTotal = normalizeNonNegativeInteger(
        result?.data?.closedDuration ?? result?.data?.totalDuration,
      );
      const nextSessionCount = normalizeNonNegativeInteger(result?.data?.sessionCount);

      setTotal((current) => sameDay ? Math.max(current, nextTotal) : nextTotal);
      setSessionCount((current) => sameDay ? Math.max(current, nextSessionCount) : nextSessionCount);
      summaryDateRef.current = nextDate;
    } catch (error) {
      reportRendererError("Error cargando total del día", error);
    }
  }, [apiAvailable, electronAPI, mountedRef]);

  return { commitClosedSession, reload, sessionCount, total };
}

function normalizeNonNegativeInteger(value) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? Math.max(0, Math.floor(numericValue)) : 0;
}
