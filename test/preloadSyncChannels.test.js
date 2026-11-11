import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

test('the real preload permits synchronization acknowledgements and retry actions', async () => {
  let api;
  const listeners = new Map(), calls = [];
  const ipcRenderer = { on: (name,callback) => listeners.set(name,callback), removeListener() {}, send() {}, invoke: async name => { calls.push(name); return { success: true }; } };
  vm.runInNewContext(readFileSync(new URL('../src/preload/preload.cjs', import.meta.url),'utf8'), {
    require: () => ({ ipcRenderer, contextBridge: { exposeInMainWorld: (_name,value) => { api = value; } } }),
    window: { addEventListener() {} }, console: { warn: message => assert.fail(message) },
  });
  let duration;
  api.events.onSessionSynced(data => { duration = data.duration; });
  listeners.get('event:session-synced')({}, { duration: 552 });
  assert.equal(duration,552);
  await api.retrySessionSync();
  assert.equal(calls[0],'timer:sync-pending');
});
