import { useCallback, useState } from "react";
import { runSingleFlight } from "../utils/singleFlight.js";
import { reportRendererError } from "../utils/rendererError.js";

export default function useTodaySummary({
  apiAvailable,
  electronAPI,
  mountedRef,
}) {
  const [total, setTotal] = useState(0);
  const [sessionCount, setSessionCount] = useState(0);

  const reload = useCallback(async () => {
    if (!apiAvailable) return;

    try {
      const result = await runSingleFlight("today-total", () => electronAPI.getTodayTotal());
      if (!result?.success) {
        throw new Error(result?.message || "No se pudo cargar el total del día.");
      }
      if (!mountedRef.current) return;

      setTotal(normalizeNonNegativeInteger(result?.data?.totalDuration));
      setSessionCount(normalizeNonNegativeInteger(result?.data?.sessionCount));
    } catch (error) {
      reportRendererError("Error cargando total del día", error);
    }
  }, [apiAvailable, electronAPI, mountedRef]);

  return { reload, sessionCount, total };
}

function normalizeNonNegativeInteger(value) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? Math.max(0, Math.floor(numericValue)) : 0;
}
