export const TRAY_STATES = Object.freeze({
  active: { key: "active", color: "#16a34a", label: "Seguimiento activo" },
  paused: { key: "paused", color: "#9ca3af", label: "Seguimiento pausado" },
  inactive: {
    key: "inactive",
    color: "#64748b",
    label: "Seguimiento inactivo",
  },
});

export function getTrayState(timerStatus = {}) {
  if (timerStatus.isRunning && timerStatus.isPaused) return TRAY_STATES.paused;
  if (timerStatus.isRunning) return TRAY_STATES.active;
  return TRAY_STATES.inactive;
}
