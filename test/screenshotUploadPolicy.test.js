import assert from 'node:assert/strict';
import test from 'node:test';
import { isRetryableScreenshotUploadError } from '../src/main/services/screenshotUploadPolicy.js';

test('network, timeout, rate limit and server errors are retryable', () => {
  assert.equal(isRetryableScreenshotUploadError({ code: 'ERR_NETWORK' }), true);
  assert.equal(isRetryableScreenshotUploadError({ response: { status: 408 } }), true);
  assert.equal(isRetryableScreenshotUploadError({ response: { status: 429 } }), true);
  assert.equal(isRetryableScreenshotUploadError({ response: { status: 503 } }), true);
});

test('validation and authorization errors are permanent', () => {
  assert.equal(isRetryableScreenshotUploadError({ response: { status: 400 } }), false);
  assert.equal(isRetryableScreenshotUploadError({ response: { status: 401 } }), false);
  assert.equal(isRetryableScreenshotUploadError({ response: { status: 403 } }), false);
  assert.equal(isRetryableScreenshotUploadError({ response: { status: 422 } }), false);
});
