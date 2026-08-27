import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeNativeBrowserDomainMessage } from '../src/main/services/windowsBrowserUrlPolicy.js';

test('la captura nativa conserva solo el dominio y rechaza URLs completas', () => {
  const now = Date.now();
  assert.deepEqual(
    normalizeNativeBrowserDomainMessage(
      { domain: 'WWW.Docs.Google.com', observedAt: new Date(now).toISOString() },
      now,
    ),
    { domain: 'docs.google.com', observedAt: now },
  );
  assert.equal(
    normalizeNativeBrowserDomainMessage(
      { domain: 'docs.google.com/document/secret', observedAt: new Date(now).toISOString() },
      now,
    ),
    null,
  );
});

test('la captura nativa descarta mensajes antiguos o malformados', () => {
  const now = Date.now();
  assert.equal(
    normalizeNativeBrowserDomainMessage(
      { domain: 'example.com', observedAt: new Date(now - 180000).toISOString() },
      now,
    ),
    null,
  );
  assert.equal(normalizeNativeBrowserDomainMessage('example.com', now), null);
});
