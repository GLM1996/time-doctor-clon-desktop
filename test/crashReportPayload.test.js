import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeCrashReportInput } from '../src/main/services/crashReportPayload.js';

test('renderer crash payload only accepts bounded scalar fields', () => {
  const report = normalizeCrashReportInput({
    eventType: { unexpected: true },
    message: 'password=secret ' + 'x'.repeat(600),
    stack: ['not', 'a', 'string'],
    processType: 'main',
    severity: 'administrator',
    extra: 'ignored',
  }, 'renderer');

  assert.equal(report.processType, 'renderer');
  assert.equal(report.eventType, 'unknown');
  assert.equal(report.message.length, 500);
  assert.doesNotMatch(report.message, /secret/);
  assert.equal(report.stack, null);
  assert.equal(report.severity, 'error');
  assert.equal('extra' in report, false);
});

test('invalid crash payload produces a safe report', () => {
  assert.deepEqual(normalizeCrashReportInput(null), {
    processType: 'unknown',
    eventType: 'unknown',
    message: 'Unknown desktop error',
    stack: null,
    severity: 'error',
  });
});
