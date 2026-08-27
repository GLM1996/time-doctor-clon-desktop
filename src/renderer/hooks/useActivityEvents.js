import { useCallback, useEffect, useRef, useState } from "react";
import { INITIAL_ACTIVITY_STATUS } from "./useTimerSession.js";
import { getRendererErrorMessage, sanitizeRendererText } from "../utils/rendererError.js";

const NOTIFICATION_DURATION_MS = 10000;

export default function useActivityEvents({ apiAvailable, electronAPI, mountedRef }) {
  const [activityStatus, setActivityStatus] = useState(INITIAL_ACTIVITY_STATUS);
  const [idleCountdown, setIdleCountdown] = useState(null);
  const [idleNotification, setIdleNotification] = useState(null);
  const notificationTimeoutRef = useRef(null);

  const clearNotificationTimeout = useCallback(() => {
    if (!notificationTimeoutRef.current) return;
    window.clearTimeout(notificationTimeoutRef.current);
    notificationTimeoutRef.current = null;
  }, []);

  const clearTransientStates = useCallback(() => {
    setIdleCountdown(null);
    setIdleNotification(null);
    clearNotificationTimeout();
  }, [clearNotificationTimeout]);

  useEffect(() => {
    if (!apiAvailable) return undefined;

    const unsubscribeActivity = electronAPI.events.onActivityUpdate((data = {}) => {
      if (!mountedRef.current) return;

      const status = data.status === "active" ? "active" : "idle";
      setActivityStatus({
        percentage: normalizePercentage(data.activityPercentage ?? data.percentage),
        status,
        activeWindow:
          typeof data.activeWindow === "string" && data.activeWindow.trim()
            ? sanitizeRendererText(data.activeWindow, 160)
            : "Esperando actividad...",
      });

      if (status === "active") setIdleCountdown(null);
    });

    const unsubscribeCountdown = electronAPI.events.onIdleCountdown((data) => {
      if (!mountedRef.current) return;
      if (!data) {
        setIdleCountdown(null);
        return;
      }
      setIdleCountdown({
        ...data,
        idleSeconds: normalizeSeconds(data.idleSeconds),
        secondsUntilClose: normalizeSeconds(data.secondsUntilClose),
        closeAt: normalizeSeconds(data.closeAt),
      });
    });

    const unsubscribeNotification = electronAPI.events.onIdleNotification(
      (data = {}) => {
        if (!mountedRef.current) return;
        clearNotificationTimeout();
        setIdleNotification({
          message: getRendererErrorMessage(
            { message: data.message },
            "Se detectó un período de inactividad.",
          ),
        });
        notificationTimeoutRef.current = window.setTimeout(() => {
          if (mountedRef.current) setIdleNotification(null);
          notificationTimeoutRef.current = null;
        }, NOTIFICATION_DURATION_MS);
      },
    );

    return () => {
      unsubscribeActivity?.();
      unsubscribeCountdown?.();
      unsubscribeNotification?.();
      clearNotificationTimeout();
    };
  }, [apiAvailable, clearNotificationTimeout, electronAPI, mountedRef]);

  return {
    activityStatus,
    clearTransientStates,
    idleCountdown,
    idleNotification,
    setActivityStatus,
  };
}

function normalizePercentage(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return 0;
  return Math.min(100, Math.max(0, Math.round(numericValue)));
}

function normalizeSeconds(value) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? Math.max(0, Math.floor(numericValue)) : 0;
}
