import { useCallback, useEffect, useState } from "react";
import { runSingleFlight } from "../utils/singleFlight.js";
import { getRendererErrorMessage, reportRendererError } from "../utils/rendererError.js";

export default function useBreakControl({
  activeBreak,
  apiAvailable,
  electronAPI,
  isLoading,
  isRunning,
  mountedRef,
  operationRef,
  setActiveBreak,
  setError,
  setIsLoading,
  setPendingAction,
}) {
  const [breakTypes, setBreakTypes] = useState([]);
  const [selectedBreakTypeId, setSelectedBreakTypeId] = useState("");

  useEffect(() => {
    if (!apiAvailable) return;
    let active = true;

    runSingleFlight("break-options", () => electronAPI.getBreaks())
      .then((result) => {
        if (!active) return;
        if (!result?.success) return;
        const types = Array.isArray(result.data?.types) ? result.data.types : [];
        setBreakTypes(types);
        setActiveBreak(result.data?.current || null);
        setSelectedBreakTypeId((current) => current || types[0]?._id || "");
      })
      .catch((error) => {
        if (active) reportRendererError("No se pudieron cargar las pausas", error);
      });
    return () => {
      active = false;
    };
  }, [apiAvailable, electronAPI, isRunning, setActiveBreak]);

  useEffect(() => {
    if (!apiAvailable || typeof electronAPI.events?.onBreakEnded !== "function") return;
    return electronAPI.events.onBreakEnded(() => setActiveBreak(null));
  }, [apiAvailable, electronAPI, setActiveBreak]);

  const toggleBreak = useCallback(
    async (typeId) => {
      if (operationRef.current || isLoading || !apiAvailable) return;
      if (!activeBreak && !typeId) {
        setError("Selecciona un tipo de pausa antes de continuar.");
        return;
      }

      const action = activeBreak ? "resume" : "pause";
      operationRef.current = action;
      setIsLoading(true);
      setPendingAction(action);
      setError("");

      try {
        const result = activeBreak
          ? await electronAPI.stopBreak()
          : await electronAPI.startBreak({ typeId });
        if (!result?.success) {
          throw new Error(result?.message || "No se pudo actualizar la pausa.");
        }
        setActiveBreak(activeBreak ? null : result.data);
      } catch (error) {
        reportRendererError("No se pudo actualizar la pausa", error);
        if (mountedRef.current) {
          setError(getRendererErrorMessage(error, "No se pudo actualizar la pausa."));
        }
      } finally {
        operationRef.current = "";
        if (mountedRef.current) {
          setIsLoading(false);
          setPendingAction("");
        }
      }
    },
    [
      activeBreak,
      apiAvailable,
      electronAPI,
      isLoading,
      mountedRef,
      operationRef,
      setActiveBreak,
      setError,
      setIsLoading,
      setPendingAction,
    ],
  );

  return {
    breakTypes,
    selectedBreakTypeId,
    setSelectedBreakTypeId,
    toggleBreak,
  };
}
