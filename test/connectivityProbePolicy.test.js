import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldApplyProbeResult } from '../src/main/services/connectivityProbePolicy.js';

test('aplica un health check si ninguna senal mas reciente aparecio', () => {
  assert.equal(shouldApplyProbeResult(3, 3), true);
});

test('ignora resultados anteriores a una senal API o del renderer', () => {
  assert.equal(shouldApplyProbeResult(3, 4), false);
  assert.equal(shouldApplyProbeResult(undefined, 4), false);
});
