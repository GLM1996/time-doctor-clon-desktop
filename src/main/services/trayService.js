import { Menu, Notification, Tray, nativeImage } from 'electron';
import { deflateSync } from 'node:zlib';

import logger from '../utils/logger.js';
import { authStore } from './store.js';
import timerService from './timerService.js';
import { getTrayState, TRAY_STATES } from './trayStatus.js';

class TrayService {
  constructor() {
    this.tray = null;
    this.getMainWindow = () => null;
    this.onQuit = () => {};
    this.unsubscribeTimer = null;
    this.closeNoticeShown = false;
  }

  initialize({ getMainWindow, onQuit }) {
    if (this.tray) return;

    if (typeof getMainWindow === 'function') this.getMainWindow = getMainWindow;
    if (typeof onQuit === 'function') this.onQuit = onQuit;

    this.tray = new Tray(createStatusIcon(TRAY_STATES.inactive.color));
    this.tray.setIgnoreDoubleClickEvents(true);
    this.tray.on('click', () => this.showWindow());
    this.unsubscribeTimer = timerService.onStatusChange(() => this.refresh());
    this.refresh();
    logger.info('Bandeja del sistema inicializada.');
  }

  refreshIdentity() {
    this.refresh();
  }

  refresh() {
    if (!this.tray || this.tray.isDestroyed()) return;

    const timerStatus = timerService.getStatus();
    const status = getTrayState(timerStatus);
    const organizationName = getOrganizationName(authStore.getUser());

    this.tray.setImage(createStatusIcon(status.color));
    this.tray.setToolTip(
      ['LogYourTime', status.label, organizationName].join(' • '),
    );
    this.tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'LogYourTime', enabled: false },
      {
        label: status.label,
        icon: createStatusDot(status.color),
        enabled: false,
      },
      {
        label: `Organización: ${organizationName}`,
        enabled: false,
      },
      { type: 'separator' },
      { label: 'Abrir LogYourTime', click: () => this.showWindow() },
      { type: 'separator' },
      {
        label: 'Salir de LogYourTime',
        click: () => {
          Promise.resolve(this.onQuit()).catch((error) => {
            logger.error(
              `No se pudo cerrar desde la bandeja: ${error.message}`,
            );
          });
        },
      },
    ]));
  }

  showWindow() {
    const mainWindow = this.getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed()) return;

    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }

  notifyCloseToTray() {
    if (this.closeNoticeShown) return;
    this.closeNoticeShown = true;
    if (!Notification.isSupported()) return;

    const trayState = getTrayState(timerService.getStatus());
    const body = trayState.key === 'active'
      ? 'El seguimiento continúa activo. Puedes abrir o cerrar la aplicación desde la bandeja del sistema.'
      : trayState.key === 'paused'
        ? 'El seguimiento permanece pausado. Puedes reanudarlo desde LogYourTime o salir desde la bandeja.'
        : 'La aplicación se ocultó en la bandeja del sistema. Desde allí puedes abrirla o salir por completo.';

    new Notification({
      title: 'LogYourTime sigue funcionando',
      body,
      silent: true,
    }).show();
  }

  destroy() {
    this.unsubscribeTimer?.();
    this.unsubscribeTimer = null;
    if (this.tray && !this.tray.isDestroyed()) this.tray.destroy();
    this.tray = null;
  }
}

function getOrganizationName(user) {
  const candidates = [
    user?.organization?.name,
    user?.organizationName,
    user?.companyName,
  ];
  const name = candidates.find(
    (value) => typeof value === 'string' && value.trim(),
  );
  if (!name) return 'Sin organización identificada';

  const normalizedName = name.trim();
  return normalizedName.length > 48
    ? `${normalizedName.slice(0, 45)}...`
    : normalizedName;
}

function createStatusIcon(color) {
  return nativeImage.createFromBuffer(
    createPngIcon(32, color, false),
  );
}

function createStatusDot(color) {
  return nativeImage.createFromBuffer(
    createPngIcon(16, color, true),
  );
}

function createPngIcon(size, hexColor, dotOnly) {
  const pixels = Buffer.alloc(size * size * 4);
  const color = hexToRgb(hexColor);
  const center = (size - 1) / 2;
  const radius = dotOnly ? size * 0.34 : size * 0.46;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const distance = Math.hypot(x - center, y - center);
      const offset = (y * size + x) * 4;

      if (dotOnly) {
        if (distance <= radius) {
          setPixel(pixels, offset, color, 255);
        }
        continue;
      }

      if (distance <= radius) {
        const border = distance >= radius - Math.max(3, size * 0.13);
        setPixel(
          pixels,
          offset,
          border ? color : { r: 37, g: 39, b: 34 },
          255,
        );
      }
    }
  }

  if (!dotOnly) {
    drawLine(pixels, size, center, center, center, size * 0.24, 3.2);
    drawLine(pixels, size, center, center, size * 0.69, size * 0.62, 3.2);
    drawCircle(pixels, size, center, center, 2.3, color);
  }

  return encodePng(pixels, size, size);
}

function drawLine(pixels, size, x1, y1, x2, y2, width) {
  const minX = Math.max(0, Math.floor(Math.min(x1, x2) - width));
  const maxX = Math.min(size - 1, Math.ceil(Math.max(x1, x2) + width));
  const minY = Math.max(0, Math.floor(Math.min(y1, y2) - width));
  const maxY = Math.min(size - 1, Math.ceil(Math.max(y1, y2) + width));
  const lengthSquared = (x2 - x1) ** 2 + (y2 - y1) ** 2;

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const projection = Math.max(0, Math.min(1,
        ((x - x1) * (x2 - x1) + (y - y1) * (y2 - y1)) /
          lengthSquared,
      ));
      const px = x1 + projection * (x2 - x1);
      const py = y1 + projection * (y2 - y1);

      if (Math.hypot(x - px, y - py) <= width / 2) {
        setPixel(
          pixels,
          (y * size + x) * 4,
          { r: 255, g: 255, b: 255 },
          255,
        );
      }
    }
  }
}

function drawCircle(pixels, size, cx, cy, radius, color) {
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (Math.hypot(x - cx, y - cy) <= radius) {
        setPixel(pixels, (y * size + x) * 4, color, 255);
      }
    }
  }
}

function setPixel(buffer, offset, color, alpha) {
  buffer[offset] = color.r;
  buffer[offset + 1] = color.g;
  buffer[offset + 2] = color.b;
  buffer[offset + 3] = alpha;
}

function hexToRgb(value) {
  const hex = value.replace('#', '');
  return {
    r: Number.parseInt(hex.slice(0, 2), 16),
    g: Number.parseInt(hex.slice(2, 4), 16),
    b: Number.parseInt(hex.slice(4, 6), 16),
  };
}

function encodePng(pixels, width, height) {
  const rows = Buffer.alloc((width * 4 + 1) * height);

  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * (width * 4 + 1);
    rows[rowOffset] = 0;
    pixels.copy(
      rows,
      rowOffset + 1,
      y * width * 4,
      (y + 1) * width * 4,
    );
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;

  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(rows)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, checksum]);
}

function crc32(buffer) {
  let crc = 0xffffffff;

  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }

  return (crc ^ 0xffffffff) >>> 0;
}

export default new TrayService();
