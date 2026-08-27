import test from 'node:test';
import assert from 'node:assert/strict';
import { calculatePeriodActivity, createActivityBaseline } from '../src/main/services/screenshotActivityPeriod.js';

test('calcula la actividad durante todo el periodo entre capturas', () => {
  const baseline = createActivityBaseline({ activeTime: 20, idleTime: 10 });
  const result = calculatePeriodActivity(
    { activeTime: 425, idleTime: 145 },
    baseline,
  );

  assert.equal(result.measuredSeconds, 540);
  assert.equal(result.percentage, 75);
});

test('un intervalo sin actividad produce cero sin inventar un porcentaje', () => {
  const baseline = createActivityBaseline({ activeTime: 100, idleTime: 50 });
  const result = calculatePeriodActivity(
    { activeTime: 100, idleTime: 590 },
    baseline,
  );

  assert.equal(result.measuredSeconds, 540);
  assert.equal(result.percentage, 0);
});

test('sin un periodo anterior no fuerza la primera captura a cien', () => {
  const result = calculatePeriodActivity({ activeTime: 0, idleTime: 0 });
  assert.equal(result.measuredSeconds, 0);
  assert.equal(result.percentage, 0);
});
