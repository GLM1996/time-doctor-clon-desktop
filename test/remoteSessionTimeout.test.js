import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { confirmRemoteClosure, getRemoteSessionState } from '../src/main/services/remoteSessionPolicy.js';
import { showTrackingStoppedAlert } from '../src/main/services/trackingStoppedAlert.js';

// Exercise the service methods without starting Electron, native monitoring or disk storage.
const source = readFileSync(new URL('../src/main/services/timerService.js', import.meta.url), 'utf8')
  .replace(/^import[\s\S]*?;\r?\n/gm, '')
  .replace('export default new TimerService();', 'globalThis.TimerService = TimerService;');

function service(remote, { fail = false } = {}) {
  const events = [];
  const alerts = [];
  const context = vm.createContext({
    logger: { warn() {}, debug() {} }, confirmRemoteClosure,
    apiClient: { get: async () => { if (fail) throw new Error('offline'); return { data: { success: true, data: remote } }; } },
    IPC_CHANNELS: { EVENT_SESSION_CLOSED: 'closed' },
    formatDuration: seconds => String(seconds),
    getMainWindow: () => ({}), Notification: {},
    showTrackingStoppedAlert: data => alerts.push(data),
  });
  vm.runInContext(source, context);
  const timer = Object.create(context.TimerService.prototype);
  Object.assign(timer, { isRunning: true, isOffline: false, sessionId: 'one', elapsedSeconds: 2700 });
  timer._stopServices = () => { timer.servicesStopped = true; };
  timer._resetSessionState = () => { timer.isRunning = false; timer.sessionId = null; };
  timer._notifyUI = (...args) => events.push(args);
  return { timer, events, alerts };
}

test('45 minutes of work continue after server timeout without resetting counters or alerting', async () => {
  const { timer, events, alerts } = service({ _id: 'one', status: 'ended', autoClosed: true, closedReason: 'timeout' });
  await timer._checkSessionStatus();
  assert.equal(timer.isRunning, true);
  assert.equal(timer.sessionId, 'one');
  assert.equal(timer.elapsedSeconds, 2700);
  assert.equal(timer.servicesStopped, undefined);
  assert.equal(events.length, 0);
  assert.equal(alerts.length, 0);
  assert.equal(await timer.handleRemoteSessionClosed('one', 'activity-rejected'), false, 'caller must retain rejected snapshots for retry');
});

test('confirmed manual closure stops tracking and presents an alert exactly once', async () => {
  const { timer, events, alerts } = service({ _id: 'one', status: 'ended', autoClosed: false, closedReason: 'manual' });
  await timer._checkSessionStatus();
  assert.equal(timer.isRunning, false);
  assert.equal(timer.servicesStopped, true);
  assert.equal(events[0][1].reason, 'backend');
  assert.equal(alerts.length, 1);
  await timer.handleRemoteSessionClosed('one', 'activity-rejected');
  assert.equal(alerts.length, 1);
});

test('failed verification and stale status do not stop current tracking or authorize discarding pending activity', async () => {
  const { timer } = service(null, { fail: true });
  assert.equal(await timer.handleRemoteSessionClosed('one'), false);
  assert.equal(timer.isRunning, true);
  assert.equal(await timer.handleRemoteSessionClosed('one', 'status-check', { _id: 'different', status: 'ended' }), false);
  assert.equal(timer.isRunning, true);
});

test('only an automatic timeout is recoverable; other definitive closures still stop tracking', () => {
  assert.equal(getRemoteSessionState({ status: 'ended', autoClosed: false, closedReason: 'timeout' }), 'closed');
  assert.equal(getRemoteSessionState({ status: 'ended', autoClosed: true, closedReason: 'inactivity' }), 'closed');
  assert.equal(getRemoteSessionState({ status: 'active' }), 'open');
  assert.equal(getRemoteSessionState(null), 'unknown');
});

test('stop alert restores and centers the app, notifies Windows and restores window priority', context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const calls = [];
  let click;
  const window = { isDestroyed: () => false, isMinimized: () => true, isAlwaysOnTop: () => false,
    isFullScreen: () => false, isMaximized: () => false, isFocused: () => true, moveTop() {},
    restore: () => calls.push('restore'), center: () => calls.push('center'), setAlwaysOnTop: value => calls.push(['top', value]),
    show: () => calls.push('show'), focus: () => calls.push('focus'), flashFrame() {}, once() {} };
  class Notification {
    static isSupported() { return true; }
    constructor(data) { assert.equal(data.timeoutType, 'never'); }
    on(event, callback) { if (event === 'click') click = callback; }
    show() { calls.push('notice'); }
  }
  showTrackingStoppedAlert({ window, Notification, message: 'Registro detenido' });
  assert.deepEqual(calls.slice(0, 5), ['restore', 'center', ['top', true], 'show', 'focus']);
  assert.ok(calls.includes('notice'));
  context.mock.timers.tick(2000);
  assert.deepEqual(calls.at(-1), ['top', false]);
  click();
  assert.equal(calls.at(-1), 'focus');
});
