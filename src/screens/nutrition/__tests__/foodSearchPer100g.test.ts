import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const searchSource = readFileSync('src/screens/nutrition/FoodSearchScreen.tsx', 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const rowSource = readFileSync('src/components/nutrition/FoodRow.tsx', 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('Food search/listing labels values as "por 100 g"', () => {
  it('passes per100g + proteinG for catalog and custom-food results (a base value, not a chosen serving)', () => {
    const customRow = searchSource.match(/<FoodRow key=\{food\.id\} name=\{food\.name\} origin="custom"[^/]*\/>/)?.[0];
    expect(customRow).toContain('per100g');
    expect(customRow).toContain('proteinG={food.nutritionPer100g.proteinG}');

    const catalogRow = searchSource.match(/<FoodRow key=\{food\.id\} name=\{food\.name\} brandName=\{food\.brandName\}[^/]*\/>/)?.[0];
    expect(catalogRow).toContain('per100g');
    expect(catalogRow).toContain('proteinG={food.nutritionPer100g.proteinG}');
  });

  it('FoodRow only appends the "per 100 g" copy when no concrete grams amount is shown', () => {
    expect(rowSource).toMatch(/grams == null && per100g \? t\('registerMeal\.per100g'\) : null/);
    expect(rowSource).toMatch(/grams == null && proteinG != null \? `\$\{proteinG\}/);
  });
});
