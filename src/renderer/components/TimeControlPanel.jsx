import { Coffee, Loader2, Pause, Play } from "lucide-react";

function TimeControlPanel({
  activeBreak,
  actionDisabled,
  breakTypes,
  breakElapsedSeconds,
  currentTime,
  isLoading,
  isRunning,
  loadingText,
  onBreakAction,
  onBreakTypeChange,
  onPrimaryAction,
  selectedBreakTypeId,
  todaySessions,
}) {
  const primaryLabel = isRunning
    ? "Pausar seguimiento"
    : "Iniciar seguimiento";

  return (
    <>
      <section className="overflow-hidden rounded-2xl border border-[#45483f] bg-[#30332c] p-4 text-[#f8f4eb] shadow-[0_14px_30px_rgba(33,35,30,0.16)]">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className={`h-2 w-2 rounded-full ${isRunning && !activeBreak ? "bg-[#91a184] shadow-[0_0_0_4px_rgba(145,161,132,0.14)]" : "bg-[#85887e]"}`}
              />
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#bbbdb4]">
                Tiempo total de hoy
              </p>
            </div>
            <p
              className="mt-2 whitespace-nowrap font-mono text-[38px] font-semibold leading-none tracking-[-0.055em] text-white"
              role="timer"
              aria-live="off"
              aria-label={formatAccessibleTime(currentTime)}
            >
              {currentTime}
            </p>
          </div>

          <button
            type="button"
            onClick={onPrimaryAction}
            disabled={actionDisabled}
            aria-busy={isLoading}
            aria-label={primaryLabel}
            title={primaryLabel}
            className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-full border-4 border-[#45483f] text-white shadow-[0_10px_24px_rgba(0,0,0,0.28)] transition-[background-color,transform,box-shadow] hover:scale-[1.04] focus:outline-none focus:ring-4 active:scale-95 disabled:cursor-not-allowed disabled:opacity-55 ${isRunning ? "bg-[#b97832] hover:bg-[#a56829] focus:ring-[#b97832]/25" : "bg-[#6f8064] hover:bg-[#5f7055] focus:ring-[#91a184]/25"}`}
          >
            {isLoading ? (
              <Loader2
                className="h-6 w-6 animate-spin"
                strokeWidth={2}
                aria-hidden="true"
              />
            ) : isRunning ? (
              <Pause
                className="h-7 w-7"
                strokeWidth={2.4}
                fill="currentColor"
                aria-hidden="true"
              />
            ) : (
              <Play
                className="ml-1 h-7 w-7"
                strokeWidth={2.2}
                fill="currentColor"
                aria-hidden="true"
              />
            )}
          </button>
        </div>

        <div className="mt-3 flex items-center justify-between gap-3 border-t border-[#484b43] pt-3 text-[10px]">
          <span
            className={
              isRunning ? "font-semibold text-[#cbd6c4]" : "text-[#aeb0a8]"
            }
          >
            {isLoading
              ? loadingText
              : activeBreak
                ? `En pausa${activeBreak.type?.name ? ` · ${activeBreak.type.name}` : ""} · ${formatBreakElapsed(breakElapsedSeconds)}`
                : isRunning
                  ? "Seguimiento activo"
                  : "Listo para comenzar"}
          </span>
          <span className="shrink-0 text-[#aeb0a8]">
            {todaySessions}{" "}
            {todaySessions === 1 ? "sesión hoy" : "sesiones hoy"}
          </span>
        </div>
      </section>

      {(isRunning || activeBreak) && breakTypes.length > 0 && (
        <div className="mt-3 flex items-center gap-2 rounded-xl border border-[#e5e0d7] bg-[#fffdf8] p-2">
          <Coffee
            className="ml-1 h-4 w-4 shrink-0 text-[#8b6a45]"
            strokeWidth={1.8}
            aria-hidden="true"
          />
          <label htmlFor="break-type" className="sr-only">
            Tipo de pausa
          </label>
          <select
            id="break-type"
            value={activeBreak ? activeBreak.type?._id || selectedBreakTypeId : selectedBreakTypeId}
            onChange={onBreakTypeChange}
            disabled={isLoading || Boolean(activeBreak)}
            className="min-w-0 flex-1 rounded-lg border border-[#d8d3c9] bg-white px-2.5 py-2 text-[10px] font-semibold text-[#454840] outline-none focus:border-[#a8753e] focus:ring-2 focus:ring-[#a8753e]/15 disabled:bg-[#f2eee7]"
          >
            {breakTypes.map((type) => (
              <option key={type._id} value={type._id}>
                {type.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={onBreakAction}
            disabled={isLoading || (!activeBreak && !selectedBreakTypeId)}
            className="h-8 shrink-0 rounded-lg border border-[#d7c7b2] bg-[#f3e9dc] px-3 text-[10px] font-semibold text-[#88551f] transition-colors hover:bg-[#ead8c1] focus:outline-none focus:ring-2 focus:ring-[#a8753e]/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {activeBreak ? "Terminar pausa" : "Tomar pausa"}
          </button>
        </div>
      )}
    </>
  );
}

export default TimeControlPanel;

function formatAccessibleTime(value) {
  const [hours = 0, minutes = 0, seconds = 0] = String(value)
    .split(":")
    .map((part) => Math.max(0, Number(part) || 0));
  return `${hours} horas, ${minutes} minutos y ${seconds} segundos`;
}

function formatBreakElapsed(seconds) {
  const safe = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(safe / 60);
  const remaining = Math.floor(safe % 60);
  return `${minutes}:${String(remaining).padStart(2, "0")} transcurridos`;
}
