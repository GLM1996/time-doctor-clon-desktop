import test from 'node:test';
import assert from 'node:assert/strict';
import { getTrayState } from '../src/main/services/trayStatus.js';

test('la bandeja diferencia activo, pausado e inactivo', () => {
  assert.equal(getTrayState({ isRunning: true, isPaused: false }).key, 'active');
  assert.equal(getTrayState({ isRunning: true, isPaused: true }).key, 'paused');
  assert.equal(getTrayState({ isRunning: false, isPaused: false }).key, 'inactive');
});

test('el estado pausado utiliza gris y nunca verde', () => {
  const paused = getTrayState({ isRunning: true, isPaused: true });
  assert.equal(paused.color, '#9ca3af');
  assert.equal(paused.label, 'Seguimiento pausado');
});
