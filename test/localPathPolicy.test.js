import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import {
  isManagedPendingScreenshotName,
  isPathInsideDirectory,
} from '../src/main/services/localPathPolicy.js';

test('solo admite archivos dentro del directorio local autorizado', () => {
  const directory = path.resolve('user-data', 'pending-screenshots');
  assert.equal(isPathInsideDirectory(path.join(directory, 'capture.jpg'), directory), true);
  assert.equal(isPathInsideDirectory(path.join(directory, '..', 'auth.json'), directory), false);
  assert.equal(isPathInsideDirectory(directory, directory), false);
  assert.equal(isPathInsideDirectory(null, directory), false);
});

test('solo reconoce nombres generados por la cola de capturas', () => {
  assert.equal(isManagedPendingScreenshotName('pending-1723632000000-m0-a1b2c3.jpg'), true);
  assert.equal(isManagedPendingScreenshotName('profile.jpg'), false);
  assert.equal(isManagedPendingScreenshotName('../pending-1-m0-a.jpg'), false);
  assert.equal(isManagedPendingScreenshotName('pending-1-m0-a.png'), false);
});
