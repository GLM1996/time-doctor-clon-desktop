import React from "react";
import { Download, Loader2, RefreshCw, X } from "lucide-react";

const ACTIONABLE_PHASES = ["available", "ready", "error"];
const PROGRESS_PHASES = ["downloading", "installing"];

export function UpdateNotice({ notice, onDismiss, onUpdate }) {
  if (!notice) return null;

  const showsProgress = PROGRESS_PHASES.includes(notice.phase);
  const showsActions = ACTIONABLE_PHASES.includes(notice.phase);
  const progress = Math.max(0, Math.min(100, Number(notice.percent) || 0));

  return (
    <section
      className="mb-4 rounded-[16px] border border-[#d8b98c] bg-[#f7ecdc] p-3.5 text-left shadow-[0_10px_24px_rgba(99,66,31,0.08)]"
      aria-live="polite"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[#d8b98c] bg-[#ead7bb] text-[#76501f]">
          {showsProgress ? (
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.9} aria-hidden="true" />
          ) : notice.phase === "error" ? (
            <RefreshCw className="h-4 w-4" strokeWidth={1.9} aria-hidden="true" />
          ) : (
            <Download className="h-4 w-4" strokeWidth={1.9} aria-hidden="true" />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold text-[#4d371b]">Actualización disponible</p>
              <p className="mt-0.5 text-[9px] font-medium text-[#8a6338]">Versión {notice.version}</p>
            </div>
            {showsActions && (
              <button
                type="button"
                onClick={onDismiss}
                title="Ocultar esta actualización"
                aria-label="Ocultar notificación de actualización"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[#8a6338] transition-colors hover:bg-[#ead7bb] hover:text-[#5f411d] focus:outline-none focus:ring-4 focus:ring-[#986126]/15"
              >
                <X className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
              </button>
            )}
          </div>

          <p className="mt-1.5 text-[10px] leading-4 text-[#76542f]">{notice.message}</p>
          {showsProgress && (
            <div className="mt-2.5">
              <div className="flex items-center justify-between text-[9px] font-medium text-[#8a6338]">
                <span>{notice.phase === "installing" ? "Instalando" : "Descargando"}</span>
                <span>{Math.round(progress)}%</span>
              </div>
              <div
                className="mt-1 h-1.5 overflow-hidden rounded-full bg-[#dfc8a7]"
                role="progressbar"
                aria-label="Progreso de actualización"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={progress}
              >
                <div
                  className="h-full rounded-full bg-[#986126] transition-[width] duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}

          {showsActions && (
            <button
              type="button"
              onClick={onUpdate}
              className="mt-2.5 inline-flex h-8 items-center justify-center gap-1.5 rounded-lg bg-[#76501f] px-3 text-[10px] font-semibold text-white transition-colors hover:bg-[#5f3f18] focus:outline-none focus:ring-4 focus:ring-[#986126]/20"
            >
              {notice.phase === "error" ? (
                <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.9} aria-hidden="true" />
              ) : (
                <Download className="h-3.5 w-3.5" strokeWidth={1.9} aria-hidden="true" />
              )}
              {notice.phase === "ready"
                ? "Instalar y reiniciar"
                : notice.phase === "error"
                  ? "Reintentar"
                  : "Actualizar ahora"}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

export function SyncStatusNotice({ status }) {
  if (!status || (status.pendingTotal <= 0 && status.state === "idle")) return null;

  const hasError = status.state === "error";

  return (
    <section
      className={`mb-4 flex items-start gap-3 rounded-[16px] border p-3.5 ${
        hasError
          ? "border-[#ddb0a1] bg-[#f5e4df] text-[#98483a]"
          : "border-[#d8d1c5] bg-[#f7f3ec] text-[#5f625a]"
      }`}
      aria-live="polite"
    >
      <RefreshCw
        className={`mt-0.5 h-4 w-4 shrink-0 ${status.state === "syncing" ? "animate-spin" : ""}`}
        strokeWidth={1.8}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-semibold">
          {status.state === "syncing"
            ? "Sincronizando datos pendientes"
            : hasError
              ? "Sincronización pendiente"
              : `${status.pendingTotal} elemento${status.pendingTotal === 1 ? "" : "s"} por sincronizar`}
        </p>
        <p className="mt-1 text-[9px] leading-4 opacity-80">
          {hasError && status.lastError
            ? status.lastError
            : `${status.pendingSessions || 0} sesiones · ${status.pendingActivity || 0} actividades · ${status.pendingScreenshots || 0} capturas`}
        </p>
      </div>
    </section>
  );
}
