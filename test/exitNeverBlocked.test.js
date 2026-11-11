import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/main/index.js', import.meta.url),'utf8')
  .replace(/^import[\s\S]*?;[^\n]*\n/gm,'')
  .replace('  const createWindow = () =>','  globalThis.requestQuitForTest = requestQuit;\n  const createWindow = () =>');
test('exit proceeds immediately through failing saves and cleanup without waiting for a server', async () => {
  const handlers = new Map(), calls = [];
  const fail = () => { calls.push('save'); throw new Error('disk unavailable'); };
  const app = {
    requestSingleInstanceLock: () => true,
    whenReady: () => ({ then() {} }),
    on: (name,callback) => handlers.set(name,callback),
    quit: () => { calls.push('quit'); handlers.get('before-quit')(); }, exit() {},
  };
  const service = { destroy: () => { calls.push('cleanup'); throw new Error('cleanup failed'); }, stop: () => calls.push('stop') };
  const context = vm.createContext({
    app, process: { on() {}, platform: 'win32' }, logger: { warn() {}, info() {} },
    timerService: { prepareForShutdown: fail },
    screenshotService: service, captureRealtimeService: service, configService: service,
    autoUpdateService: service, trayService: service, connectionService: service,
    browserDomainBridge: service, windowsBrowserUrlService: service,
    setTimeout: (_callback,time) => { assert.equal(time,2000); return { unref() {} }; },
  });
  vm.runInContext(source,context);
  await context.requestQuitForTest();
  assert.equal(calls.filter(call => call === 'quit').length,1);
  assert.ok(calls.includes('stop'));
  await context.requestQuitForTest();
  assert.equal(calls.filter(call => call === 'quit').length,1);
});
