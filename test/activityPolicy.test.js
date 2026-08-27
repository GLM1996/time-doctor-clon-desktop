import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateActivityPercentage,
  getActivityStatus,
  isClosedSessionActivityError,
  isRetryableActivityError,
} from '../src/main/services/activityPolicy.js';

test('calculateActivityPercentage calcula ventanas parciales sin superar cien', () => {
  assert.equal(calculateActivityPercentage([true, false, true, false], 4), 50);
  assert.equal(calculateActivityPercentage([true, true, true], 2), 100);
  assert.equal(calculateActivityPercentage([], 0), 0);
});

test('getActivityStatus prioriza inactividad y baja actividad', () => {
  const base = { activityPercentage: 80, hasRecentInput: true, systemIdleTime: 2, idleThresholdSeconds: 60, lowActivityThreshold: 30 };
  assert.equal(getActivityStatus(base), 'active');
  assert.equal(getActivityStatus({ ...base, hasRecentInput: false }), 'inactive');
  assert.equal(getActivityStatus({ ...base, activityPercentage: 20 }), 'low_activity');
  assert.equal(getActivityStatus({ ...base, systemIdleTime: 60 }), 'idle');
});

test('los errores de actividad distinguen reintento y sesión cerrada', () => {
  assert.equal(isRetryableActivityError({ response: { status: 500 } }), true);
  assert.equal(isRetryableActivityError({ response: { status: 408 } }), true);
  assert.equal(isRetryableActivityError({ response: { status: 429 } }), true);
  assert.equal(isRetryableActivityError({ response: { status: 401 } }), false);
  assert.equal(isRetryableActivityError({ response: { status: 403 } }), false);
  assert.equal(isRetryableActivityError({ response: { status: 400 } }), false);
  assert.equal(isClosedSessionActivityError({ response: { status: 409 } }), true);
  assert.equal(isClosedSessionActivityError({ message: 'La sesión ya está cerrada' }), true);
  assert.equal(isClosedSessionActivityError({ response: { status: 400 } }), false);
});
