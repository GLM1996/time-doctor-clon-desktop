import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { TrustedClock } from '../src/main/services/trustedClock.js';
import { createActivitySnapshot, toActivityApiPayload } from '../src/main/services/activitySnapshot.js';
import { normalizeAndPrune } from '../src/main/services/activityQueueRepository.js';
import { normalizePendingSessions } from '../src/main/services/pendingSessionRepository.js';
import { normalizeScreenshotQueue, createScreenshotQueueItem, evaluateScreenshotQueueItem, scheduleScreenshotRetry } from '../src/main/services/screenshotQueuePolicy.js';
import { evaluateIdleState } from '../src/main/services/idleStatePolicy.js';
import { shouldCreateActivitySnapshot } from '../src/main/services/activityCapturePolicy.js';
import { getBreakElapsedAtObservation } from '../src/renderer/utils/breakClock.js';

const activitySource = readFileSync(new URL('../src/main/services/activityService.js', import.meta.url), 'utf8')
  .replace(/^import[\s\S]*?;\r?\n/gm, '')
  .replace('export default new ActivityService();', 'globalThis.ActivityService = ActivityService;');

test('el servicio envia actividad con hora del servidor aunque Windows tenga otra fecha', async () => {
  let tick = 0;
  const clock = new TrustedClock(() => tick);
  clock.synchronize('2026-11-11T17:00:00Z');
  const posted = [];
  const originalDate = Date;
  class IncorrectDate extends originalDate {
    constructor(...args) { super(...(args.length ? args : ['2036-01-01T00:00:00Z'])); }
    static now() { return originalDate.parse('2036-01-01T00:00:00Z'); }
  }
  const context = vm.createContext({
    Date: IncorrectDate, trustedClock: clock,
    timerService: { getStatus: () => ({ isRunning: true, isPaused: false, sessionId: 'session' }), isOffline: false },
    apiClient: { post: async (_url, payload) => posted.push(payload) },
    shouldCreateActivitySnapshot, createActivitySnapshot, toActivityApiPayload,
  });
  vm.runInContext(activitySource, context);
  const activity = Object.create(context.ActivityService.prototype);
  Object.assign(activity, { isMonitoring: true, cumulativeActiveTime: 60, cumulativeIdleTime: 0,
    systemIdleTime: 0, trackActiveWindow: true, reportIntervalSeconds: 60, activityQueue: [] });
  activity._getActivityPercentage1Min = () => 100;
  activity._getCurrentStatus = () => 'active';
  tick = 60000;
  await activity._sendSnapshotToBackend();
  assert.equal(posted.length, 1);
  assert.equal(posted[0].timestamp, '2026-11-11T17:01:00.000Z');
  assert.equal(activity._toApiPayload({}).timestamp, '2026-11-11T17:01:00.000Z');
});

test('cargar colas antes de sincronizar conserva fechas y reintentos sin usar Windows', () => {
  const date = '2026-11-11T17:00:00.000Z';
  const retry = '2026-11-11T17:00:30.000Z';
  const snapshot = { sessionId: 'session', clientEventId: 'event', timestamp: date, nextRetryAt: retry };
  const originalNow = Date.now;
  try {
    Date.now = () => Date.parse('2036-01-01T00:00:00Z');
    const [activity] = normalizeAndPrune([snapshot], { now: null });
    assert.equal(activity.timestamp, date);
    assert.equal(activity.nextRetryAt, retry);
    const [pending] = normalizePendingSessions([{ type: 'stop-existing', sessionId: 'session', nextRetryAt: retry }], null);
    assert.equal(pending.nextRetryAt, retry);
    const [capture] = normalizeScreenshotQueue([{ id: 'capture', filePath: 'pending.jpg', nextRetryAt: retry }], null);
    assert.equal(capture.nextRetryAt, retry);
    const now = Date.parse(date);
    assert.equal(normalizeAndPrune([snapshot], { now }).length, 1);
    assert.equal(normalizeAndPrune([{ ...snapshot, timestamp: '2026-10-01T00:00:00Z' }], { now }).length, 0);
  } finally { Date.now = originalNow; }
});

test('la cola de capturas reintenta segun el servidor y conserva la hora de captura', () => {
  let tick = 0;
  const clock = new TrustedClock(() => tick);
  clock.synchronize('2026-11-11T17:00:00Z');
  const timestamp = clock.date().toISOString();
  let item = createScreenshotQueueItem({ filePath: 'pending.jpg', metadata: { timestamp, sessionId: 'session' }, now: clock.date() });
  item = scheduleScreenshotRetry(item, new Error('offline'), clock.now());
  const originalNow = Date.now;
  try {
    Date.now = () => Date.parse('2000-01-01T00:00:00Z');
    assert.equal(evaluateScreenshotQueueItem(item, clock.now()).action, 'wait');
    tick = 30000;
    assert.equal(evaluateScreenshotQueueItem(item, clock.now()).action, 'upload');
    assert.equal(item.metadata.timestamp, timestamp);
    assert.equal(item.createdAt, timestamp);
  } finally { Date.now = originalNow; }
});

test('inactividad se mide con tiempo monotono aunque se adelante Windows', () => {
  let tick = 300000;
  const context = vm.createContext({ performance: { now: () => tick }, evaluateIdleState });
  vm.runInContext(activitySource, context);
  const activity = Object.create(context.ActivityService.prototype);
  Object.assign(activity, { systemIdleTime: 60, idleThresholdSeconds: 30, idleWarningSeconds: 240,
    autoCloseInactiveSeconds: 300, idleStartTime: null, warningSent: false });
  const countdown = [];
  activity._sendIdleCountdown = value => countdown.push(value);
  activity._checkInactivity();
  assert.equal(countdown.at(-1), 60);
  const originalNow = Date.now;
  try {
    Date.now = () => Date.parse('2036-01-01T00:00:00Z');
    tick += 60000;
    activity.systemIdleTime = 120;
    activity._checkInactivity();
    assert.equal(countdown.at(-1), 120);
    assert.equal(activity.warningSent, false);
  } finally { Date.now = originalNow; }
});

test('la interfaz calcula las pausas con serverNow y no usa Windows como alternativa', () => {
  const originalNow = Date.now;
  try {
    Date.now = () => Date.parse('2036-01-01T00:00:00Z');
    assert.equal(getBreakElapsedAtObservation({
      startTime: '2026-11-11T17:00:00Z', serverNow: '2026-11-11T17:05:00Z',
    }), 300);
    assert.equal(getBreakElapsedAtObservation({
      expiresAt: '2026-11-11T17:15:00Z', type: { maxMinutes: 15 }, serverNow: '2026-11-11T17:05:00Z',
    }), 300);
    assert.equal(getBreakElapsedAtObservation({ startTime: '2026-11-11T17:00:00Z' }), 0);
  } finally { Date.now = originalNow; }
});
