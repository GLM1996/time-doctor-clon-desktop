import React from "react";
import {
  AlertCircle,
  CheckCircle2,
  Hourglass,
  MousePointer2,
  TimerReset,
  WifiOff,
} from "lucide-react";

export function TimerErrorNotice({ apiAvailable, message }) {
  if (!message) return null;

  const Icon = apiAvailable ? AlertCircle : WifiOff;

  return (
    <div
      role="alert"
      className="mt-4 flex items-start gap-2.5 rounded-xl border border-[#ddb0a1] bg-[#f5e4df] px-3.5 py-3"
    >
      <Icon
        className="mt-0.5 h-4 w-4 shrink-0 text-[#a05243]"
        strokeWidth={1.8}
        aria-hidden="true"
      />
      <p className="text-[10px] leading-4 text-[#98483a]">{message}</p>
    </div>
  );
}

export function SessionResultNotice({ isRunning, result }) {
  if (!result || isRunning || result.reason !== "inactivity") return null;

  const endedByInactivity = result.reason === "inactivity";
  const Icon = endedByInactivity ? TimerReset : CheckCircle2;

  return (
    <div
      aria-live="polite"
      className={`mt-4 flex items-start gap-2.5 rounded-xl border px-3.5 py-3 ${
        endedByInactivity
          ? "border-[#dfbd8f] bg-[#fbf2e5] text-[#805b34]"
          : "border-[#bec8b5] bg-[#e8ede3] text-[#59664f]"
      }`}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.8} aria-hidden="true" />
      <div className="min-w-0">
        <p className="text-[10px] font-semibold">
          {endedByInactivity ? "Sesión cerrada por inactividad" : "Sesión guardada"}
        </p>
        <p className="mt-1 text-[10px] leading-4">
          {endedByInactivity ? result.message : `Duración: ${result.durationFormatted}`}
        </p>
      </div>
    </div>
  );
}

export function IdleCountdownNotice({ activityStatus, countdown, isRunning }) {
  const shouldShow = Boolean(
    isRunning &&
      countdown &&
      countdown.idleSeconds >= 60 &&
      activityStatus?.status !== "active",
  );

  if (!shouldShow) return null;

  const progress = normalizePercentage(
    countdown.closeAt > 0 ? (countdown.idleSeconds / countdown.closeAt) * 100 : 0,
  );

  return (
    <section className="mt-4 rounded-xl border border-[#dfbd8f] bg-[#fbf2e5] p-3.5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-[#805b34]">
          <Hourglass className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
          <span className="text-[10px] font-semibold">Inactividad detectada</span>
        </div>
        <span className="text-[10px] font-semibold text-[#704619]">
          {countdown.secondsUntilClose > 0
            ? formatCountdown(countdown.secondsUntilClose)
            : "Cerrando..."}
        </span>
      </div>

      <div
        className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-[#ead3b4]"
        role="progressbar"
        aria-label="Progreso de inactividad"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress}
      >
        <div
          className="h-full rounded-full bg-[#b97832] transition-all duration-1000"
          style={{ width: `${progress}%` }}
        />
      </div>

      <div className="mt-2 flex items-center gap-1.5 text-[9px] leading-4 text-[#8b653d]">
        <MousePointer2 className="h-3 w-3 shrink-0" strokeWidth={1.8} aria-hidden="true" />
        Mueve el mouse o presiona una tecla para continuar.
      </div>
    </section>
  );
}

export function IdleNotificationNotice({ notification }) {
  if (!notification) return null;

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="mt-3 flex items-start gap-2.5 rounded-xl border border-[#dfbd8f] bg-[#fbf2e5] px-3.5 py-3 text-[#805b34]"
    >
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.8} aria-hidden="true" />
      <p className="text-[10px] leading-4">{notification.message}</p>
    </div>
  );
}

function normalizePercentage(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return 0;
  return Math.min(100, Math.max(0, Math.round(numericValue)));
}

function formatCountdown(seconds) {
  const safeSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
  const minutes = Math.floor(safeSeconds / 60);
  return `${minutes}:${String(safeSeconds % 60).padStart(2, "0")}`;
}
