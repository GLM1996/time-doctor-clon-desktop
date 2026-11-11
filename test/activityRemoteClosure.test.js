import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { isOfflineItemReady, reconcileQueueAfterProcessing, scheduleOfflineRetry } from '../src/main/services/offlineQueuePolicy.js';
import { TrustedClock } from '../src/main/services/trustedClock.js';

const source = readFileSync(new URL('../src/main/services/activityService.js', import.meta.url), 'utf8')
  .replace(/^import[\s\S]*?;\r?\n/gm, '')
  .replace('export default new ActivityService();', 'globalThis.ActivityService = ActivityService;');

for (const confirmedClosed of [false, true]) {
  test(`queued activity is ${confirmedClosed ? 'discarded after a confirmed definitive closure' : 'retained after a timeout or unconfirmed closure, then synced once'}`, async () => {
    let rejected = true;
    let successfulWrites = 0;
    const trustedClock = new TrustedClock(() => 0);
    trustedClock.synchronize('2026-11-11T17:00:00Z');
    const context = vm.createContext({
      logger: { info() {}, debug() {}, warn() {}, error() {} },
      apiClient: { getToken: () => 'test', post: async () => {
        if (rejected) throw { response: { status: 409 } };
        successfulWrites += 1;
      } },
      timerService: { handleRemoteSessionClosed: async () => confirmedClosed },
      isAuthenticationRequiredError: () => false,
      trustedClock,
      isOfflineItemReady, reconcileQueueAfterProcessing, scheduleOfflineRetry,
    });
    vm.runInContext(source, context);
    const activity = Object.create(context.ActivityService.prototype);
    activity.activityQueue = [{ clientEventId: 'event-one', sessionId: 'session-one', timestamp: new Date().toISOString() }];
    activity._saveActivityQueue = () => {};
    activity._isClosedSessionError = () => true;
    activity._toApiPayload = snapshot => snapshot;
    await activity._processActivityQueue();
    assert.equal(activity.activityQueue.length, confirmedClosed ? 0 : 1);
    if (!confirmedClosed) {
      assert.equal(activity.activityQueue[0].clientEventId, 'event-one');
      rejected = false;
      activity.activityQueue[0].nextRetryAt = null;
      await activity._processActivityQueue();
      await activity._processActivityQueue();
      assert.equal(activity.activityQueue.length, 0);
      assert.equal(successfulWrites, 1);
    }
  });
}
