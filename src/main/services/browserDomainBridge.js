import http from 'node:http';
import logger from '../utils/logger.js';
import {
  BROWSER_EXTENSION_ORIGIN,
  isAllowedBrowserExtensionOrigin,
  normalizeBrowserDomainMessage,
} from './browserDomainPolicy.js';

export const BROWSER_BRIDGE_HOST = '127.0.0.1';
export const BROWSER_BRIDGE_PORT = 32145;
const MAX_BODY_BYTES = 1024;

class BrowserDomainBridge {
  constructor() {
    this.server = null;
  }

  start({ onDomain } = {}) {
    if (this.server) return;

    this.server = http.createServer((request, response) => {
      this._handleRequest(request, response, onDomain);
    });
    this.server.on('error', (error) => {
      logger.warn(`No se pudo iniciar el puente del navegador: ${error.message}`);
    });
    this.server.listen(BROWSER_BRIDGE_PORT, BROWSER_BRIDGE_HOST, () => {
      logger.info(`Puente del navegador listo en ${BROWSER_BRIDGE_HOST}:${BROWSER_BRIDGE_PORT}`);
    });
  }

  stop() {
    this.server?.close();
    this.server = null;
  }

  _handleRequest(request, response, onDomain) {
    const origin = request.headers.origin;
    if (
      request.method === 'OPTIONS' &&
      request.url === '/v1/active-domain' &&
      isAllowedBrowserExtensionOrigin(origin)
    ) {
      response.writeHead(204, {
        'Access-Control-Allow-Origin': BROWSER_EXTENSION_ORIGIN,
        'Access-Control-Allow-Methods': 'POST',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '600',
      }).end();
      return;
    }
    if (request.method !== 'POST' || request.url !== '/v1/active-domain') {
      response.writeHead(404).end();
      return;
    }
    if (!isAllowedBrowserExtensionOrigin(origin)) {
      response.writeHead(403).end();
      return;
    }

    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body, 'utf8') > MAX_BODY_BYTES) request.destroy();
    });
    request.on('end', () => {
      try {
        const message = normalizeBrowserDomainMessage(JSON.parse(body));
        if (!message) {
          response.writeHead(400).end();
          return;
        }
        onDomain?.(message);
        response.writeHead(204, {
          'Access-Control-Allow-Origin': BROWSER_EXTENSION_ORIGIN,
          'Cache-Control': 'no-store',
        }).end();
      } catch {
        response.writeHead(400).end();
      }
    });
  }
}

export default new BrowserDomainBridge();
