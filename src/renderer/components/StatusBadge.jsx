import React, { useState } from 'react';
import { reportRendererError } from '../utils/rendererError.js';

import {
  Loader2,
  LogOut,
  Wifi,
  WifiOff,
} from 'lucide-react';

function StatusBadge({
  connected,
  showQuitButton = false,
}) {
  const checking = connected === null;
  const [isQuitting, setIsQuitting] =
    useState(false);

  const handleQuitApp = async () => {
    if (isQuitting) {
      return;
    }

    const confirmed = window.confirm(
      '¿Estás seguro de que deseas cerrar la aplicación por completo?',
    );

    if (!confirmed) {
      return;
    }

    if (
      !window.electronAPI ||
      typeof window.electronAPI.quitApp !==
        'function'
    ) {
      reportRendererError(
        'La función de cierre no está disponible',
        new Error('ERR_IPC quitApp unavailable'),
      );

      return;
    }

    setIsQuitting(true);

    try {
      await window.electronAPI.quitApp();
    } catch (error) {
      reportRendererError(
        'Error cerrando la aplicación',
        error,
      );

      setIsQuitting(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <div
        role="status"
        aria-live="polite"
        className={`
          inline-flex h-8 items-center gap-2
          rounded-full border px-3
          text-[10px] font-semibold
          ${
            checking
              ? 'border-[#d8d2c7] bg-[#f1eee7] text-[#777970]'
              : connected
              ? 'border-[#bec8b5] bg-[#e8ede3] text-[#59664f]'
              : 'border-[#ddb0a1] bg-[#f5e4df] text-[#98483a]'
          }
        `}
      >
        <span className="relative flex h-2 w-2 shrink-0">
          {connected && !checking && (
            <span
              className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#78866b] opacity-40"
              aria-hidden="true"
            />
          )}

          <span
            className={`relative inline-flex h-2 w-2 rounded-full ${
              checking
                ? 'bg-[#9a9b95]'
                : connected
                ? 'bg-[#78866b]'
                : 'bg-[#b65d4d]'
            }`}
            aria-hidden="true"
          />
        </span>

        {checking ? (
          <Loader2
            className="h-3.5 w-3.5 animate-spin"
            strokeWidth={1.8}
            aria-hidden="true"
          />
        ) : connected ? (
          <Wifi
            className="h-3.5 w-3.5"
            strokeWidth={1.8}
            aria-hidden="true"
          />
        ) : (
          <WifiOff
            className="h-3.5 w-3.5"
            strokeWidth={1.8}
            aria-hidden="true"
          />
        )}

        <span>
          {checking
            ? 'Comprobando'
            : connected
            ? 'Conectado'
            : 'Sin conexión'}
        </span>
      </div>

      {showQuitButton && (
        <button
          type="button"
          onClick={handleQuitApp}
          disabled={isQuitting}
          title="Cerrar aplicación"
          aria-label="Cerrar aplicación por completo"
          className="
            flex h-8 w-8 items-center justify-center
            rounded-lg border border-[#d8d2c7]
            bg-[#fffdf8] text-[#777970]
            transition-colors
            hover:border-[#ddb0a1]
            hover:bg-[#f5e4df]
            hover:text-[#98483a]
            focus:outline-none
            focus:ring-4 focus:ring-[#a95444]/10
            disabled:cursor-not-allowed
            disabled:opacity-50
          "
        >
          {isQuitting ? (
            <Loader2
              className="h-3.5 w-3.5 animate-spin"
              strokeWidth={1.8}
              aria-hidden="true"
            />
          ) : (
            <LogOut
              className="h-3.5 w-3.5"
              strokeWidth={1.8}
              aria-hidden="true"
            />
          )}
        </button>
      )}
    </div>
  );
}

export default StatusBadge;
