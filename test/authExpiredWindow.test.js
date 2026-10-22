import test from 'node:test';
import assert from 'node:assert/strict';
import { showAuthExpiredWindow } from '../src/main/authExpiredWindow.js';

function fakeWindow(state = {}) {
  const calls = [];
  const window = {
    destroyed: false, top: false, ...state,
    isDestroyed() { return this.destroyed; },
    isAlwaysOnTop() { return this.top; },
    isMinimized: () => Boolean(state.minimized),
    isFullScreen: () => Boolean(state.fullScreen),
    isMaximized: () => Boolean(state.maximized),
    isFocused: () => Boolean(state.focused),
    setAlwaysOnTop(value) { this.top = value; calls.push(['top', value]); },
  };
  for (const name of ['restore', 'setFullScreen', 'unmaximize', 'center', 'show', 'moveTop', 'focus', 'flashFrame']) {
    window[name] = (...args) => calls.push([name, ...args]);
  }
  return { window, calls };
}

for (const state of [{}, { minimized: true }, { maximized: true }, { fullScreen: true }]) {
  test(`session alert restores and centers window ${JSON.stringify(state)}`, context => {
    context.mock.timers.enable({ apis: ['setTimeout'] });
    const { window, calls } = fakeWindow(state);
    showAuthExpiredWindow(window);
    for (const name of ['center', 'show', 'moveTop', 'focus']) {
      assert.ok(calls.some(call => call[0] === name));
    }
    if (state.minimized) assert.ok(calls.some(call => call[0] === 'restore'));
    if (state.maximized) assert.ok(calls.some(call => call[0] === 'unmaximize'));
    if (state.fullScreen) assert.ok(calls.some(call => call[0] === 'setFullScreen' && call[1] === false));
    assert.equal(window.top, true);
    context.mock.timers.tick(2000);
    assert.equal(window.top, false);
  });
}

test('repeated alerts restore the original topmost state', context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const { window } = fakeWindow();
  showAuthExpiredWindow(window);
  context.mock.timers.tick(1000);
  showAuthExpiredWindow(window);
  context.mock.timers.tick(2000);
  assert.equal(window.top, false);
});

test('destroyed or missing windows are ignored, including pending cleanup', context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  showAuthExpiredWindow(null);
  const { window, calls } = fakeWindow({ destroyed: true });
  showAuthExpiredWindow(window);
  assert.equal(calls.length, 0);
  window.destroyed = false;
  showAuthExpiredWindow(window);
  window.destroyed = true;
  const count = calls.length;
  context.mock.timers.tick(2000);
  assert.equal(calls.length, count);
});

test('preserves an existing topmost preference and avoids flashing a focused window', context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const { window, calls } = fakeWindow({ top: true, focused: true });
  showAuthExpiredWindow(window);
  assert.ok(!calls.some(call => call[0] === 'flashFrame' && call[1] === true));
  context.mock.timers.tick(2000);
  assert.equal(window.top, true);
});
