import test from 'node:test';
import assert from 'node:assert/strict';
import { buildStylingBrief, formatBriefAsText } from '../public/js/brief.js';

test('builds an identity-preserving real try-on brief', () => {
  const brief = buildStylingBrief({
    event: 'Wedding', garment: 'Gown', fit: 'Fitted', fabric: 'Silk', colour: '#17634e',
    idea: 'An emerald evening gown.',
    measurements: { waist: { label: 'Waist', value: 74, unit: 'cm' } },
    inspirationAdded: true, variationCount: 3
  });
  assert.equal(brief.idea, 'An emerald evening gown.');
  assert.equal(brief.measurements.waist.value, 74);
  assert.equal(brief.variationCount, 3);
  assert.ok(brief.instructions.some(item => item.includes('original person')));
  assert.ok(brief.instructions.some(item => item.includes('Waist: 74 cm')));
  assert.ok(brief.instructions.some(item => item.includes('inspiration garment')));
  assert.ok(brief.instructions.some(item => item.includes('overlay appearance')));
});

test('creates fallback copy when the written idea is empty', () => {
  const brief = buildStylingBrief({
    event: 'Gala', garment: 'Suit', fit: 'Structured', fabric: 'Velvet', colour: '#111111',
    idea: '   ', measurements: {}, inspirationAdded: false, variationCount: 1
  });
  assert.equal(brief.idea, 'Create a structured suit suitable for gala.');
  assert.match(formatBriefAsText(brief), /Requested variations: 1/);
  assert.match(formatBriefAsText(brief), /preserve the original person/i);
});
