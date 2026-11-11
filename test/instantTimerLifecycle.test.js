import { buildTimerUpdate } from '../src/main/services/timerStatus.js';
import { buildOfflineSessionPayload } from '../src/main/services/pendingSessionPolicy.js';
import { describeSessionSyncError } from '../src/main/services/sessionSyncErrors.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { SessionEventJournal } from '../src/main/services/sessionEventJournal.js';
import { TrustedClock } from '../src/main/services/trustedClock.js';
import { buildDeviceInfo, buildWorkSelection, createOfflineSession, normalizeStopInput } from '../src/main/services/sessionPayloads.js';
import { calculateElapsedSeconds, formatDuration } from '../src/main/services/timerServiceUtils.js';
import { shouldAcceptTimerUpdate } from '../src/renderer/hooks/useTimerSession.js';

const source = readFileSync(new URL('../src/main/services/timerService.js', import.meta.url), 'utf8')
  .replace(/^import[\s\S]*?;\r?\n/gm, '')
  .replace('export default new TimerService();', 'globalThis.TimerService = TimerService;');
function setup() {
  let tick = 0, disk = [];
  const clock = new TrustedClock(() => tick); clock.synchronize('2026-11-11T12:00:00Z');
  const events = [];
  const context = vm.createContext({
    buildDeviceInfo, buildWorkSelection, createOfflineSession, normalizeStopInput, calculateElapsedSeconds, formatDuration, buildOfflineSessionPayload, describeSessionSyncError, buildTimerUpdate,
    trustedClock: clock, process: { platform: 'win32' }, app: { getVersion: () => '1.3.1' },
    authStore: { getUser: () => ({ _id: 'user', organization: 'org' }) },
    configService: { getConfig: () => ({}), setTrackingActive() {}, startSync() {}, stopSync() {} },
    apiClient: { isConnected: true, get: async () => ({ data: { capabilities: { sessionEvents: 1 } } }) }, logger: { info() {}, warn() {}, error() {}, debug() {} },
    activityService: { getSnapshot: () => ({}), stop() {}, replaceSessionId() {} }, screenshotService: { stop() {}, async replaceSessionId() {} },
    IPC_CHANNELS: { EVENT_SESSION_CLOSED: 'closed' },
  });
  vm.runInContext(source, context);
  const timer = Object.create(context.TimerService.prototype);
  Object.assign(timer, { isRunning: false, sessionJournal: new SessionEventJournal({
    read: () => [], write: records => { disk = structuredClone(records); },
  }) });
  timer._startTicker = () => {}; timer._startConfiguredServices = () => {};
  timer._cleanupIntervals = () => {}; timer._notifyStatusChange = () => {};
  timer._notifySyncUpdate = () => {}; timer._requestSessionSync = () => {};
  timer._notifyUI = (channel, data) => events.push({ channel, data });
  return { timer, events, context, clock, api: context.apiClient, advance: value => { tick = value; }, disk: () => disk };
}

test('start and stop accept immediately without any HTTP response and freeze at 09:12', async () => {
  const { timer, advance, disk, events } = setup();
  const started = await timer.start();
  assert.equal(timer.isRunning, true);
  assert.equal(disk()[0].startTime, '2026-11-11T12:00:00.000Z');
  advance(552000);
  const stopped = await timer.stop();
  assert.equal(stopped.duration, 552);
  assert.equal(timer.isRunning, false);
  assert.equal(disk()[0].endTime, '2026-11-11T12:09:12.000Z');
  advance(600000);
  assert.equal(events[0].data.duration, 552);
  assert.equal(events[0].data.sessionId, started.sessionId);
});

test('late timer updates cannot restart a stopped counter or modify a new session', () => {
  assert.equal(shouldAcceptTimerUpdate({ closing: true, activeId: 'one' }, { sessionId: 'one', isRunning: true }), false);
  assert.equal(shouldAcceptTimerUpdate({ closing: false, activeId: null }, { sessionId: 'one', isRunning: true }), false);
  assert.equal(shouldAcceptTimerUpdate({ closing: false, activeId: 'two' }, { trackingId: 'one' }), false);
  assert.equal(shouldAcceptTimerUpdate({ closing: false, activeId: 'one' }, { trackingId: 'one', sessionId: 'remote-one' }), true);
});

test('the actual service preserves the frozen result when a delayed start and stop finally sync', async () => {
  const { timer, advance, api, events } = setup();
  let resolveStart;
  const slowStart = new Promise(resolve => { resolveStart = resolve; });
  const requests = [];
  api.post = async (url, body) => {
    requests.push({ url, body });
    if (url === '/sessions') return slowStart;
    return { data: { success: true, data: { _id: 'remote', status: 'ended', totalDuration: 552 } } };
  };
  const start = await timer.start();
  const syncing = timer._syncSessionEvents();
  advance(552000);
  const stopped = await timer.stop();
  assert.equal(stopped.duration, 552);
  advance(600000);
  resolveStart({ data: { success: true, data: { _id: 'remote', status: 'active' } } });
  await syncing;
  assert.equal(requests[0].body.startTime, '2026-11-11T12:00:00.000Z');
  assert.equal(requests[0].body.localId, start.sessionId);
  assert.equal(requests[1].body.endTime, '2026-11-11T12:09:12.000Z');
  assert.equal(timer.isRunning, false);
  assert.equal(events.find(event => event.channel === 'event:session-synced').data.adjusted, false);
  assert.equal(timer.sessionJournal.records.length, 0);
});

test('closing the app persists the final instant without waiting for the server', async () => {
  const { timer, advance, disk } = setup();
  await timer.start();
  advance(552000);
  timer.prepareForShutdown();
  assert.equal(timer.isRunning, false);
  assert.equal(disk()[0].endTime, '2026-11-11T12:09:12.000Z');
  assert.equal(disk()[0].reason, 'system');
});

test('older backend keeps the live timer local and imports the exact completed interval', async () => {
  const { timer, advance, api, events } = setup();
  api.get = async () => ({ data: { serverNow: '2026-11-11T12:00:00Z' } });
  const calls = [];
  api.post = async (url, body) => {
    calls.push({ url, body });
    return { data: { success: true, data: { _id: 'legacy-remote', status: 'ended', totalDuration: 552 } } };
  };
  await timer.start();
  await timer._syncSessionEvents();
  assert.equal(calls.length, 0);
  assert.equal(timer.isRunning, true);
  advance(552000); await timer.stop();
  await timer._syncSessionEvents();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/sessions/sync-offline');
  assert.equal(calls[0].body.duration, 552);
  assert.equal(calls[0].body.endTime, '2026-11-11T12:09:12.000Z');
  assert.equal(timer.sessionJournal.records.length, 0);
  assert.equal(events.find(event => event.channel === 'event:session-synced').data.adjusted, false);
});

test('a previous validation latch never blocks starting another local session', async () => {
  const { timer } = setup();
  timer.sessionJournal.start({ localId: 'old', ownerId: 'org:user', startTime: '2026-11-11T11:00:00Z' });
  timer.sessionJournal.update('old', { blocked: true, lastError: 'Error de validación' });
  await timer.start();
  assert.equal(timer.isRunning, true);
  assert.equal(timer.sessionJournal.records.length, 2);
});

test('at the second boundary the displayed sample and the persisted stop agree', async () => {
  for (const elapsed of [9999,10000,10001]) {
    const { timer, advance, context, clock } = setup();
    let tick, displayed;
    context.setInterval = (callback, interval) => { assert.equal(interval,100); tick=callback; return 1; };
    context.clearInterval = () => {};
    context.BrowserWindow = { getAllWindows: () => [{ isDestroyed: () => false, webContents: { send: (_channel,data) => { displayed=data.elapsedSeconds; } } }] };
    await timer.start();
    context.TimerService.prototype._startTicker.call(timer);
    advance(elapsed); tick();
    // A later synchronization may be behind; the shared clock cannot retract an observed instant.
    clock.synchronize('2026-11-11T12:00:09.000Z');
    const result=await timer.stop();
    assert.equal(result.duration,displayed);
    assert.equal(displayed,Math.floor(elapsed/1000));
  }
});

test('a delayed break response freezes the counter and credits the completed work instead of zero', async () => {
  const { timer, advance, api, events } = setup();
  await timer.start(); timer.isOffline=false; timer.sessionId='remote'; timer.supportsBreakEventTime=true;
  advance(10000);
  let finish, payload;
  api.post = (_url,body) => { payload=body; return new Promise(resolve => { finish=resolve; }); };
  timer._scheduleBreakExpiration=()=>{};
  const pausing=timer.startBreak('break-type');
  assert.equal(timer.isPausing,true);
  assert.equal(timer.elapsedSeconds,10);
  advance(15000);
  finish({ data: { success:true,data:{ _id:'break', startTime:'2026-11-11T12:00:10Z', closedSession:{durationSeconds:10} } } });
  await pausing;
  assert.equal(payload.endTime,'2026-11-11T12:00:10.000Z');
  assert.equal(events.find(event=>event.data.reason==='break').data.durationSeconds,10);
  assert.equal(timer.isPausing,false);
  assert.equal(timer.isRunning,false);
});
