import test from 'node:test';
import assert from 'node:assert/strict';
import { convertMeasurement, getBodyRatios } from '../public/js/measurements.js';

test('converts centimetres to inches', () => {
  assert.equal(convertMeasurement(2.54, 'cm', 'in'), 1);
  assert.equal(convertMeasurement(170, 'cm', 'in'), 66.9);
});

test('converts inches to centimetres', () => {
  assert.equal(convertMeasurement(1, 'in', 'cm'), 2.5);
  assert.equal(convertMeasurement(66.9, 'in', 'cm'), 169.9);
});

test('returns default body ratios when measurements are missing', () => {
  assert.deepEqual(getBodyRatios({}), {
    chestToWaist: 1.22,
    hipsToWaist: 1.28
  });
});

test('calculates body ratios from provided measurements', () => {
  assert.deepEqual(getBodyRatios({
    chest: { value: 90 },
    waist: { value: 75 },
    hips: { value: 99 }
  }), {
    chestToWaist: 1.2,
    hipsToWaist: 1.32
  });
});
