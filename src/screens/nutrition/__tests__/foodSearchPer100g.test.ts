import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const searchSource = readFileSync('src/screens/nutrition/FoodSearchScreen.tsx', 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const rowSource = readFileSync('src/components/nutrition/FoodRow.tsx', 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('Food search/listing labels values as "por 100 g"', () => {
  it('passes per100g + proteinG for custom-food results (no natural-unit concept for a custom food)', () => {
    const customRow = searchSource.match(/<FoodRow key=\{food\.id\} name=\{food\.name\} origin="custom"[^/]*\/>/)?.[0];
    expect(customRow).toContain('per100g');
    expect(customRow).toContain('proteinG={food.nutritionPer100g.proteinG}');
  });

  it('Fase C7 — amplo catalog results show the default natural unit instead of a blanket "por 100 g" when one exists', () => {
    const catalogRow = searchSource.match(/<FoodRow key=\{food\.id\} name=\{food\.name\} brandName=\{food\.brandName\}[^;]*?onPress=\{\(\) => \{ void selectFoodLogResult\(food\); \}\}\s*\/>/)?.[0];
    expect(catalogRow).toContain('per100g={!servingNutrients}');
    expect(catalogRow).toContain('servingLabel={defaultUnit?.label}');
    expect(searchSource).toMatch(/const defaultUnit = raw \? resolveDefaultServingUnit\(raw\.servings, raw\.defaultServingId\) : null;/);
    expect(searchSource).toMatch(/const servingNutrients = defaultUnit \? nutrientsForServing\(food\.nutritionPer100g, defaultUnit\) : null;/);
  });

  it('FoodRow falls back to the "per 100 g" copy only when the caller gives no servingLabel and no concrete grams amount', () => {
    expect(rowSource).toMatch(/grams == null && \(servingLabel \?\? \(per100g \? t\('registerMeal\.per100g'\) : null\)\)/);
    expect(rowSource).toMatch(/grams == null && proteinG != null \? `\$\{proteinG\}/);
  });
});
