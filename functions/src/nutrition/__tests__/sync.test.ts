import { describe, expect, it } from 'vitest';

const { sync } = require('../../../../scripts/syncNutritionToFunctions.cjs') as {
  sync(check: boolean): string[];
};

describe('Nutrition shared source packaging', () => {
  it('keeps the deployed pure Engine, catalog math, contracts and rollout identical to app sources', () => {
    expect(sync(true)).toEqual([]);
  });
});
