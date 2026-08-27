import React from "react";
import { Clock3 } from "lucide-react";

export default function TimerHeader({ isRunning }) {
  return (
    <header className="border-b border-[#e5e0d7] bg-[#f4f0e8] px-5 py-3.5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#986126]">
            Espacio de trabajo
          </p>
          <h1 className="mt-1 text-base font-semibold tracking-[-0.02em] text-[#30332c]">
            Mi jornada
          </h1>
        </div>

        <div
          className={`flex h-10 w-10 items-center justify-center rounded-xl border ${
            isRunning
              ? "border-[#bec8b5] bg-[#e8ede3] text-[#59664f]"
              : "border-[#d8d3c8] bg-[#eeeae2] text-[#777970]"
          }`}
          title={isRunning ? "Seguimiento activo" : "Seguimiento inactivo"}
          role="status"
          aria-label={isRunning ? "Seguimiento activo" : "Seguimiento inactivo"}
        >
          <Clock3 className="h-5 w-5" strokeWidth={1.8} aria-hidden="true" />
        </div>
      </div>
    </header>
  );
}
