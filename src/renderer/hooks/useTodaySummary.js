import { useCallback, useEffect, useRef, useState } from "react";
import { resolveTodaySummary, reconcileTodayTotal, subscribeTodayRefresh } from '../utils/todaySummary.js';
import { runSingleFlight } from "../utils/singleFlight.js";
import { reportRendererError } from "../utils/rendererError.js";

export default function useTodaySummary({
  apiAvailable,
  electronAPI,
  mountedRef,
}) {
  const [total, setTotal] = useState(0);
  const [sessionCount, setSessionCount] = useState(0);
  const [periods, setPeriods] = useState(null);
  const summaryDateRef = useRef(null);
  const revisionRef = useRef(0);

  const commitClosedSession = useCallback((durationSeconds) => {
    revisionRef.current += 1;
    const duration = normalizeNonNegativeInteger(durationSeconds);
    setTotal((current) => current + duration);
    setPeriods(current => current ? { week: current.week + duration, month: current.month + duration } : null);
    setSessionCount((current) => current + 1);
  }, []);

  const reload = useCallback(async () => {
    if (!apiAvailable) return;

    try {
      const revision = revisionRef.current;
      const result = await runSingleFlight(`today-total:${revision}`, () => electronAPI.getTodayTotal());
      if (!result?.success) {
        throw new Error(result?.message || "No se pudo cargar el total del día.");
      }
      if (!mountedRef.current || revision !== revisionRef.current) return;

      const nextDate = result?.data?.date || null;
      const sameDay = Boolean(nextDate && summaryDateRef.current === nextDate);
      // La interfaz suma el contador vivo por separado. Usar el subtotal cerrado
      // evita duplicar la sesión activa que el backend incluye en totalDuration.
      const summary = resolveTodaySummary(result.data);
      setTotal((current) => reconcileTodayTotal(current,summary.total,{ sameDay,authoritative:summary.authoritative }));
      setSessionCount((current) => reconcileTodayTotal(current,summary.sessionCount,{ sameDay,authoritative:summary.authoritative }));
      if (result.data?.periods) {
        setPeriods(current => Object.fromEntries(["week", "month"].map(key => [key,
          reconcileTodayTotal(current?.[key] || 0, resolveTodaySummary(result.data.periods[key]).total,
            { sameDay, authoritative: summary.authoritative }),
        ])));
      }
      summaryDateRef.current = nextDate;
    } catch (error) {
      reportRendererError("Error cargando total del día", error);
    }
  }, [apiAvailable, electronAPI, mountedRef]);

  useEffect(() => {
    if (!apiAvailable) return undefined;
    return subscribeTodayRefresh(reload,window);
  },[apiAvailable,reload]);

  return { commitClosedSession, reload, sessionCount, total, periods };
}

function normalizeNonNegativeInteger(value) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? Math.max(0, Math.floor(numericValue)) : 0;
}
