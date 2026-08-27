import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeCrashText } from '../src/main/services/crashSanitizer.js';

test('sanitizeCrashText removes credentials, URLs and user paths', () => {
  const input = 'Bearer abc.def password=hunter2 whsec_abc123 at C:\\Users\\Gustavo\\app.js https://example.com/private';
  const output = sanitizeCrashText(input);
  assert.doesNotMatch(output, /abc\.def|hunter2|whsec_abc123|Gustavo|example\.com/);
  assert.match(output, /REDACTED/);
  assert.match(output, /USER_PATH/);
  assert.match(output, /\[URL\]/);
});

test('sanitizeCrashText enforces its maximum length', () => {
  assert.equal(sanitizeCrashText('x'.repeat(100), 12).length, 12);
});

test('sanitizeCrashText removes user and session identifiers from logs', () => {
  const input = [
    'user@example.com',
    '507f1f77bcf86cd799439011',
    '550e8400-e29b-41d4-a716-446655440000',
    'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature',
  ].join(' ');
  const output = sanitizeCrashText(input);
  assert.doesNotMatch(output, /user@example|507f1f77|550e8400|eyJhbGci/);
  assert.match(output, /\[EMAIL\]|\[ID\]|\[TOKEN\]/);
});
