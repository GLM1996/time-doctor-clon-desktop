import test from 'node:test';
import assert from 'node:assert/strict';
import { describeSessionSyncError } from '../src/main/services/sessionSyncErrors.js';
test('validation errors retain their field details rather than only a generic banner', () => {
  assert.match(describeSessionSyncError({ response: { data: { message: 'Error de validación', errors: ['startTime no está permitido'] } } }), /startTime/);
});
