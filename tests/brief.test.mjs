import test from 'node:test';
import assert from 'node:assert/strict';
import { buildStylingBrief, formatBriefAsText } from '../public/js/brief.js';

test('builds a structured styling brief', () => {
  const brief = buildStylingBrief({
    event: 'Wedding',
    garment: 'Gown',
    fit: 'Fitted',
    fabric: 'Silk',
    colour: '#17634e',
    idea: 'An emerald evening gown.',
    measurements: {
      waist: { label: 'Waist', value: 74, unit: 'cm' }
    },
    inspirationAdded: true
  });

  assert.equal(brief.idea, 'An emerald evening gown.');
  assert.equal(brief.measurements.waist.value, 74);
  assert.ok(brief.instructions.some(item => item.includes('inspiration image')));
  assert.ok(brief.instructions.some(item => item.includes('Waist: 74 cm')));
});

test('creates fallback copy when the written idea is empty', () => {
  const brief = buildStylingBrief({
    event: 'Gala',
    garment: 'Suit',
    fit: 'Structured',
    fabric: 'Velvet',
    colour: '#111111',
    idea: '   ',
    measurements: {},
    inspirationAdded: false
  });

  assert.equal(brief.idea, 'Create a structured suit suitable for gala.');
  assert.match(formatBriefAsText(brief), /Gala · Suit · Structured/);
});
