import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isVersionNewer,
  normalizeDownloadProgress,
  normalizeUpdateCheckInterval,
} from '../src/main/services/autoUpdatePolicy.js';

test('limita el intervalo de comprobacion de actualizaciones', () => {
  assert.equal(normalizeUpdateCheckInterval(1), 15);
  assert.equal(normalizeUpdateCheckInterval(9999), 1440);
  assert.equal(normalizeUpdateCheckInterval('60.9'), 60);
  assert.equal(normalizeUpdateCheckInterval('invalid'), 60);
});

test('normaliza el progreso antes de enviarlo a la interfaz', () => {
  assert.deepEqual(normalizeDownloadProgress({
    percent: 150, bytesPerSecond: -5, transferred: Number.NaN, total: '100.4',
  }), {
    percent: 100, bytesPerSecond: 0, transferred: 0, total: 100,
  });
});

test('solo considera disponible una version semanticamente superior', () => {
  assert.equal(isVersionNewer('1.2.5', '1.2.4'), true);
  assert.equal(isVersionNewer('1.3.0', '1.2.4'), true);
  assert.equal(isVersionNewer('1.2.4', '1.2.4'), false);
  assert.equal(isVersionNewer('1.2.3', '1.2.4'), false);
  assert.equal(isVersionNewer('', '1.2.4'), false);
});
