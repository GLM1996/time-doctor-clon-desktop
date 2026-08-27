import assert from 'node:assert/strict';
import test from 'node:test';
import { resolvePrimarySourceIndex } from '../src/main/services/displayCapturePolicy.js';

test('identifica el monitor principal por display_id aunque no sea el primero', () => {
  const sources = [{ display_id: '20' }, { display_id: '10' }];
  assert.equal(resolvePrimarySourceIndex(sources, 10), 1);
});

test('mantiene un fallback compatible si Electron no entrega display_id', () => {
  assert.equal(resolvePrimarySourceIndex([{ name: 'one' }], 10), 0);
  assert.equal(resolvePrimarySourceIndex([], 10), -1);
});
