import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/screens/nutrition/RecipeQuantityModal.tsx', 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/.*$/gm, '');

describe('RecipeQuantityModal', () => {
  it('only offers the grams/portion toggle when the recipe actually has servings', () => {
    expect(source).toMatch(/const hasServings = typeof recipe\?\.servings === 'number' && recipe\.servings > 0;/);
    expect(source).toMatch(/\{hasServings \? \(/);
  });

  it('resolves grams via recipePortionToGrams in portion mode, and accepts the raw value in grams mode', () => {
    expect(source).toMatch(
      /const grams = mode === 'grams' \? amount : \(recipe \? recipePortionToGrams\(recipe, amount\) : null\);/,
    );
  });

  it('never confirms a non-positive or unresolved gram amount', () => {
    expect(source).toMatch(/const valid = grams != null && isPositiveGrams\(grams\);/);
    expect(source).toMatch(/disabled=\{!valid\}/);
  });
});
