import assert from 'node:assert/strict';
import test from 'node:test';
import { extractDesktopSettings, normalizeSyncIntervalMinutes } from '../src/main/services/desktopConfigResponse.js';

test('desktop settings require a successful object response', () => {
  const settings = { screenshots: { enabled: true } };
  assert.equal(extractDesktopSettings({ success: true, data: { settings } }), settings);
  assert.throws(() => extractDesktopSettings({ success: true, data: {} }), /incompleta/);
  assert.throws(() => extractDesktopSettings({ success: false, message: 'denied' }), /denied/);
});

test('configuration sync interval is bounded', () => {
  assert.equal(normalizeSyncIntervalMinutes(0), 1);
  assert.equal(normalizeSyncIntervalMinutes(30.8), 30);
  assert.equal(normalizeSyncIntervalMinutes(9999), 1440);
  assert.equal(normalizeSyncIntervalMinutes('invalid'), 5);
});
