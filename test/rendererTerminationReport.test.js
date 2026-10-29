import assert from 'node:assert/strict';
import test from 'node:test';
import { rendererTerminationReport } from '../src/main/services/rendererTerminationReport.js';
import { normalizeCrashReportInput } from '../src/main/services/crashReportPayload.js';

test('termination report preserves diagnostic code and context through sanitization', () => {
  const report = normalizeCrashReportInput(rendererTerminationReport({ reason: 'killed', exitCode: -1073741819 }, {
    windowAgeSeconds: 12, visible: true, electronVersion: '43.1.0', osVersion: '10.0.26100',
  }));
  assert.match(report.message, /no identifica quién/);
  assert.match(report.message, /-1073741819 \(0xC0000005\)/);
  assert.match(report.stack, /apertura de ventana: 12/);
  assert.match(report.stack, /Ventana visible: true/);
  assert.match(report.stack, /10.0.26100/);
  assert.equal(report.severity, 'fatal');
});

test('normal exits and application shutdown are warnings, memory failures explain the reason', () => {
  assert.equal(rendererTerminationReport({ reason: 'clean-exit', exitCode: 0 }).severity, 'warning');
  assert.equal(rendererTerminationReport({ reason: 'killed', exitCode: 0 }, { quitting: true }).severity, 'warning');
  const report = rendererTerminationReport({ reason: 'oom' });
  assert.match(report.message, /falta de memoria/);
  assert.match(report.message, /no disponible/);
  assert.equal(report.severity, 'fatal');
});
