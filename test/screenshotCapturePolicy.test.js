import assert from 'node:assert/strict';
import test from 'node:test';
import {
  shouldCaptureScreenshot,
  shouldQueueScreenshotForLater,
  constrainScreenshotDimensions,
} from '../src/main/services/screenshotCapturePolicy.js';

test('screenshots require both an active service and running timer', () => {
  assert.equal(shouldCaptureScreenshot({ serviceActive: true, timerStatus: { isRunning: true } }), true);
  assert.equal(shouldCaptureScreenshot({ serviceActive: false, timerStatus: { isRunning: true } }), false);
  assert.equal(shouldCaptureScreenshot({ serviceActive: true, timerStatus: { isRunning: false } }), false);
});

test('offline or unauthenticated screenshots wait instead of uploading without a session', () => {
  assert.equal(shouldQueueScreenshotForLater({ sessionId: 'offline-one', hasToken: true }), true);
  assert.equal(shouldQueueScreenshotForLater({ sessionId: 'remote-one', hasToken: false }), true);
  assert.equal(shouldQueueScreenshotForLater({ sessionId: 'remote-one', hasToken: true }), false);
});

test('paused tracking never permits screenshots', () => {
  assert.equal(shouldCaptureScreenshot({ serviceActive: true, timerStatus: { isRunning: true, isPaused: true } }), false);
});

test('las capturas se ajustan dentro de ambos límites sin deformarse', () => {
  assert.deepEqual(
    constrainScreenshotDimensions({ width: 3440, height: 1440, maxWidth: 1920, maxHeight: 1080 }),
    { width: 1920, height: 803, resized: true },
  );
  assert.deepEqual(
    constrainScreenshotDimensions({ width: 1080, height: 1920, maxWidth: 1920, maxHeight: 1080 }),
    { width: 607, height: 1080, resized: true },
  );
});

test('una captura dentro de la política conserva sus dimensiones', () => {
  assert.deepEqual(
    constrainScreenshotDimensions({ width: 1366, height: 768, maxWidth: 1920, maxHeight: 1080 }),
    { width: 1366, height: 768, resized: false },
  );
});
