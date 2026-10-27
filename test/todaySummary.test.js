import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveTodaySummary,reconcileTodayTotal,subscribeTodayRefresh } from '../src/renderer/utils/todaySummary.js';
test('subtotal de escritorio incluye ajuste manual y pausas sin duplicar reloj activo',() => {
  const summary=resolveTodaySummary({ settledDuration:5700,totalDuration:6300,activeDuration:600,closedDuration:3600,manualDuration:1800,paidBreakDuration:300,authoritative:true });
  assert.equal(summary.total,5700); assert.equal(summary.total+600,6300);
  assert.equal(resolveTodaySummary({ closedDuration:3600,manualDuration:1800,paidBreakDuration:300 }).total,5700);
  assert.equal(resolveTodaySummary({ totalDuration:6300,activeDuration:600 }).total,5700);
});
test('correcciones se reflejan al aumentar o disminuir, sin perder cierres offline',() => {
  assert.equal(reconcileTodayTotal(3600,5400,{ sameDay:true,authoritative:true }),5400);
  assert.equal(reconcileTodayTotal(5400,3600,{ sameDay:true,authoritative:true }),3600);
  assert.equal(reconcileTodayTotal(5400,3600,{ sameDay:true,authoritative:false }),5400);
  assert.equal(reconcileTodayTotal(5400,0,{ sameDay:false,authoritative:false }),0);
});
test('refresca cada 30 segundos, al enfocar y reconectar, y cancela al desmontar',() => {
  const listeners=new Map(); let intervalCallback,cleared=false,calls=0;
  const target={
    setInterval(fn,ms){ assert.equal(ms,30000); intervalCallback=fn; return 1; },
    clearInterval(id){ assert.equal(id,1); cleared=true; },
    addEventListener(name,fn){ listeners.set(name,fn); },
    removeEventListener(name,fn){ assert.equal(listeners.get(name),fn); listeners.delete(name); },
  };
  const stop=subscribeTodayRefresh(() => { calls++; },target);
  intervalCallback(); listeners.get('focus')(); listeners.get('online')();
  assert.equal(calls,3); stop(); assert.equal(cleared,true); assert.equal(listeners.size,0);
});
