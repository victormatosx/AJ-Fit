import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/screens/nutrition/MealFeedbackSheet.tsx', 'utf8');

describe('MealFeedbackSheet — free-form plan items, no catalog dependency', () => {
  it('never calls formatFoodDisplayName on a recommended option\'s foods — those are free-form AI names, not catalog names', () => {
    expect(source).not.toMatch(/formatFoodDisplayName/);
    expect(source).toMatch(/label=\{food\.name\}/);
  });
});
