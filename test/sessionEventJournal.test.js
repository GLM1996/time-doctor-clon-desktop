import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionEventJournal } from '../src/main/services/sessionEventJournal.js';

const start = { localId: 'offline-one', ownerId: 'org:user', startTime: '2026-11-11T12:00:00.000Z' };
function journal(initial = []) {
  let disk = structuredClone(initial);
  const store = new SessionEventJournal({ read: () => disk, write: value => { disk = structuredClone(value); } });
  return { store, read: () => structuredClone(disk) };
}
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }

test('a stop during a delayed start persists immediately and sends its exact instant later', async () => {
  const { store, read } = journal();
  store.start(start);
  const network = deferred();
  const sent = [];
  const syncing = store.sync(start.ownerId, {
    create: async item => { sent.push(item.startTime); return network.promise; },
    stop: async item => { sent.push(item.endTime); return { status: 'ended', totalDuration: 552 }; },
  });
  store.stop(start.localId, '2026-11-11T12:09:12.000Z');
  assert.equal(read()[0].endTime, '2026-11-11T12:09:12.000Z');
  network.resolve({ _id: 'remote-one', status: 'active' });
  await syncing;
  assert.deepEqual(sent, [start.startTime, '2026-11-11T12:09:12.000Z']);
  assert.equal(read().length, 0);
});

test('lost acknowledgements replay the same identity and survive process restart', async () => {
  const { store, read } = journal();
  store.start(start); store.stop(start.localId, '2026-11-11T12:09:12.000Z');
  const remote = new Map(); let creates = 0; let first = true;
  const create = async item => {
    if (!remote.has(item.localId)) { creates++; remote.set(item.localId, { _id: 'remote', status: 'active' }); }
    if (first) { first = false; throw new Error('connection lost after commit'); }
    return remote.get(item.localId);
  };
  await assert.rejects(store.sync(start.ownerId, { create }), /connection lost/);
  const restored = journal(read()).store;
  await restored.sync(start.ownerId, { create, stop: async item => {
    assert.equal(item.endTime, '2026-11-11T12:09:12.000Z');
    return { status: 'ended' };
  } });
  assert.equal(creates, 1);
  assert.equal(restored.records.length, 0);
});

test('restart closes at the last checkpoint without counting powered-off time', () => {
  const { store, read } = journal(); store.start(start);
  store.checkpoint(start.localId, '2026-11-11T12:05:00.000Z');
  const restored = journal(read()).store; restored.recover();
  assert.equal(restored.find(start.localId).endTime, '2026-11-11T12:05:00.000Z');
  assert.equal(restored.find(start.localId).reason, 'system');
});

test('disk failures never acknowledge a start or discard an unpersisted stop', () => {
  let fail = true;
  const store = new SessionEventJournal({ read: () => [], write: () => { if (fail) throw new Error('disk full'); } });
  assert.throws(() => store.start(start), /disk full/);
  assert.equal(store.records.length, 0);
  fail = false; store.start(start); fail = true;
  assert.throws(() => store.stop(start.localId, '2026-11-11T12:01:00.000Z'), /disk full/);
  assert.equal(store.find(start.localId).endTime, null);
});

test('events belonging to another account are never uploaded', async () => {
  const { store } = journal(); store.start(start);
  await store.sync('org:someone-else', { create: () => assert.fail('wrong owner') });
  assert.equal(store.records.length, 1);
});

test('rejected events remain visible for review and are not repeatedly sent', async () => {
  const { store } = journal(); store.start(start);
  let calls = 0;
  const handlers = { create: async () => { calls++; throw Object.assign(new Error('permission denied'), { response: { status: 403 } }); } };
  await assert.rejects(store.sync(start.ownerId, handlers));
  assert.equal(store.find(start.localId).blocked, true);
  await assert.rejects(store.sync(start.ownerId, handlers));
  assert.equal(calls, 1);
});
