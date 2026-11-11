import { showAuthExpiredWindow as showAttentionWindow } from '../authExpiredWindow.js';

export function showTrackingStoppedAlert({ window, Notification, message }) {
  const showWindow = () => showAttentionWindow(window);
  showWindow();
  if (Notification.isSupported()) {
    const notice = new Notification({ title: 'Registro de tiempo detenido', body: message, urgency: 'critical', timeoutType: 'never' });
    notice.on('click', showWindow);
    notice.show();
  }
}
