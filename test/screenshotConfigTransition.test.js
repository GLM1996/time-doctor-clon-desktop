import assert from 'node:assert/strict';
import test from 'node:test';
import { getScreenshotConfigTransition } from '../src/main/services/screenshotConfigTransition.js';

test('combined enable and interval changes produce one restart', () => {
  assert.deepEqual(getScreenshotConfigTransition({ oldConfig: { screenshots: { enabled: false, intervalMinutes: 5 } }, newConfig: { screenshots: { enabled: true, intervalMinutes: 10 } }, isCapturing: false, trackingActive: true }), { action: 'restart', intervalMinutes: 10 });
});

test('configuration never resumes screenshots while paused', () => {
  assert.equal(getScreenshotConfigTransition({ oldConfig: {}, newConfig: { screenshots: { enabled: true } }, isCapturing: false, trackingActive: false }).action, 'none');
});

test('disabling screenshots stops active capture once', () => {
  assert.equal(getScreenshotConfigTransition({ oldConfig: {}, newConfig: { screenshots: { enabled: false } }, isCapturing: true, trackingActive: true }).action, 'stop');
});
