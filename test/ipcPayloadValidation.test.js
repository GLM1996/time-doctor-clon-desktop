import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeBreakPayload,
  normalizeLoginPayload,
  normalizeScreenshotStartPayload,
  normalizeTimerStartPayload,
  normalizeTimerStopPayload,
} from '../src/main/ipc/payloadValidation.js';

test('screenshot interval is an integer between one and sixty minutes', () => {
  assert.equal(normalizeScreenshotStartPayload({ intervalMinutes: 0 }).intervalMinutes, 1);
  assert.equal(normalizeScreenshotStartPayload({ intervalMinutes: 999 }).intervalMinutes, 60);
  assert.equal(normalizeScreenshotStartPayload({ intervalMinutes: '4.9' }).intervalMinutes, 4);
  assert.equal(normalizeScreenshotStartPayload(null).intervalMinutes, 5);
});

test('login normalizes email and rejects oversized credentials', () => {
  assert.deepEqual(normalizeLoginPayload({ email: ' USER@Example.COM ', password: 'secret' }), {
    email: 'user@example.com',
    password: 'secret',
    rememberCredentials: false,
  });
  assert.equal(normalizeLoginPayload({ email: 'a@b.com', password: 'secret', rememberCredentials: true }).rememberCredentials, true);
  assert.equal(normalizeLoginPayload({ email: 'a@b.com', password: 'x'.repeat(1025) }).password, '');
});

test('timer payload keeps only bounded scalar device data', () => {
  const result = normalizeTimerStartPayload({
    projectId: ' project ',
    taskId: ['invalid'],
    deviceInfo: { hostname: 'A'.repeat(300), nested: { secret: true }, active: true },
  });

  assert.equal(result.projectId, 'project');
  assert.equal(result.taskId, null);
  assert.equal(result.deviceInfo.hostname.length, 256);
  assert.equal(result.deviceInfo.active, true);
  assert.equal('nested' in result.deviceInfo, false);
});

test('notes and break identifiers are normalized and bounded', () => {
  assert.deepEqual(normalizeBreakPayload({ typeId: ' lunch ', notes: ' note ' }), {
    typeId: 'lunch',
    notes: 'note',
  });
  assert.equal(normalizeTimerStopPayload({ notes: 'x'.repeat(2500) }).notes.length, 2000);
  assert.equal(normalizeTimerStopPayload(null).reason, 'manual');
});
