const pendingAlerts = new WeakMap();

export function showAuthExpiredWindow(window) {
  if (!window || window.isDestroyed()) return;
  const previous = pendingAlerts.get(window);
  const wasAlwaysOnTop = previous?.wasAlwaysOnTop ?? window.isAlwaysOnTop();
  if (previous) clearTimeout(previous.timer);
  if (window.isMinimized()) window.restore();
  if (window.isFullScreen()) window.setFullScreen(false);
  if (window.isMaximized()) window.unmaximize();
  window.center();
  window.setAlwaysOnTop(true);
  window.show();
  window.moveTop();
  window.focus();
  if (!window.isFocused()) window.flashFrame(true);
  const timer = setTimeout(() => {
    pendingAlerts.delete(window);
    if (!window.isDestroyed()) {
      window.setAlwaysOnTop(wasAlwaysOnTop);
      window.flashFrame(false);
    }
  }, 2000);
  timer.unref?.();
  pendingAlerts.set(window, { timer, wasAlwaysOnTop });
}
