import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BROWSER_EXTENSION_ORIGIN,
  isAllowedBrowserExtensionOrigin,
  normalizeBrowserDomainMessage,
} from '../src/main/services/browserDomainPolicy.js';

test('acepta solo el origen estable de la extensión oficial', () => {
  assert.equal(isAllowedBrowserExtensionOrigin(BROWSER_EXTENSION_ORIGIN), true);
  assert.equal(
    isAllowedBrowserExtensionOrigin('chrome-extension://extension-falsa'),
    false,
  );
  assert.equal(isAllowedBrowserExtensionOrigin('https://example.com'), false);
});

test('el puente conserva solo un dominio válido y un timestamp reciente', () => {
  const now = Date.now();
  assert.deepEqual(
    normalizeBrowserDomainMessage(
      { domain: 'WWW.YouTube.com', observedAt: new Date(now).toISOString() },
      now,
    ),
    { domain: 'youtube.com', observedAt: now },
  );
  assert.equal(
    normalizeBrowserDomainMessage(
      { domain: 'youtube.com/path?secret=1', observedAt: new Date(now).toISOString() },
      now,
    ),
    null,
  );
  assert.equal(
    normalizeBrowserDomainMessage(
      { domain: 'youtube.com', observedAt: new Date(now - 180000).toISOString() },
      now,
    ),
    null,
  );
});
