import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileObservedElapsed } from '../src/renderer/hooks/useTimerSession.js';

test('a delayed acknowledgement cannot move the displayed counter backwards', () => {
  assert.equal(reconcileObservedElapsed(10,9,false),10);
  assert.equal(reconcileObservedElapsed(10,undefined,false),10);
});

test('only a new main-process sample can advance the visible counter', () => {
  let displayed=9;
  for (let tick=0;tick<40;tick++) displayed=reconcileObservedElapsed(displayed,9,false);
  assert.equal(displayed,9);
  displayed=reconcileObservedElapsed(displayed,10,false);
  assert.equal(displayed,10);
  assert.equal(reconcileObservedElapsed(displayed,10,true),10);
});

test('a confirmed reset and real server corrections remain possible', () => {
  assert.equal(reconcileObservedElapsed(10,0,true),0);
  assert.equal(reconcileObservedElapsed(10,9,true),9);
});
