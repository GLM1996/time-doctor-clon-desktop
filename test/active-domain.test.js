import test from 'node:test';
import assert from 'node:assert/strict';
import { isDomainExcluded, normalizeActiveDomain, normalizeExcludedDomains } from '../src/main/services/activeDomain.js';
import { createActivitySnapshot, toActivityApiPayload } from '../src/main/services/activitySnapshot.js';

test('extrae solo el dominio de una URL fiable y elimina datos sensibles', () => {
  assert.equal(normalizeActiveDomain('https://www.Example.com/private/path?token=secret'), 'example.com');
  assert.equal(normalizeActiveDomain('file:///private/file'), null);
  assert.equal(normalizeActiveDomain('https://user:pass@example.com'), null);
});

test('las exclusiones cubren el dominio y todos sus subdominios', () => {
  assert.deepEqual(normalizeExcludedDomains([' WWW.Example.com ', 'example.com', 'bad value']), ['example.com']);
  assert.equal(isDomainExcluded('example.com', ['example.com']), true);
  assert.equal(isDomainExcluded('mail.example.com', ['example.com']), true);
  assert.equal(isDomainExcluded('notexample.com', ['example.com']), false);
});

test('propaga el dominio normalizado al contrato de actividad', () => {
  const snapshot = createActivitySnapshot({ sessionId: 'session', activityPercentage: 50, activeTime: 10, idleTime: 0, activeDomain: 'Example.COM', trackActiveWindow: true });
  assert.equal(snapshot.activeDomain, 'example.com');
  assert.equal(toActivityApiPayload(snapshot).activeDomain, 'example.com');
});

test('la privacidad de ventana desactiva también la captura de dominio', () => {
  const snapshot = createActivitySnapshot({ sessionId: 'session', activityPercentage: 50, activeTime: 10, idleTime: 0, activeDomain: 'example.com', trackActiveWindow: false });
  assert.equal(snapshot.activeDomain, null);
});
