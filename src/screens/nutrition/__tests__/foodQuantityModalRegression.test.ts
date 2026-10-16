import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const strip = (path: string) => readFileSync(path, 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/.*$/gm, '');

const shellSource = strip('src/screens/nutrition/NutritionShell.tsx');
const searchSource = strip('src/screens/nutrition/FoodSearchScreen.tsx');
const modalSource = strip('src/screens/nutrition/FoodQuantityModal.tsx');

/**
 * Regression for the exact production bug found by the P0/causa-raiz
 * audit: picking a catalog/custom food from the Diário's per-slot "+"
 * (`NutritionDiaryScreen` -> `FoodSearchScreen` -> `NutritionShell`) used
 * to call `addDiaryFood(..., food.foodId, 100)` with a hardcoded `100`
 * immediately on selection — no quantity/unit confirmation step existed
 * for this branch, even though the search row already showed the food's
 * correct natural unit (e.g. "1 unidade (50 g)" for ovo).
 *
 * Fix: `NutritionFoodPick` now carries `servings`/`defaultServingId`
 * through from the resolved `FoodLogEntry`, and the non-recipe branch of
 * `onSelect` defers the write to a new `FoodQuantityModal` (same deferred
 * pattern `RecipeQuantityModal` already used for recipes), which resolves
 * the food's default natural unit before the user confirms.
 */
describe('food quantity regression: diary "+" no longer writes a hardcoded 100 g', () => {
  it('NutritionFoodPick carries servings/defaultServingId through the catalog pick', () => {
    const start = searchSource.indexOf('export interface NutritionFoodPick');
    const end = searchSource.indexOf('}', start);
    const body = searchSource.slice(start, end);
    expect(body).toMatch(/servings\?: FoodLogServingUnit\[\]/);
    expect(body).toMatch(/defaultServingId\?: string \| null/);
  });

  it('selectFoodLogResult forwards servings/defaultServingId for a materialized result, not just nutritionPer100g', () => {
    const start = searchSource.indexOf('const selectFoodLogResult');
    const end = searchSource.indexOf('const selectRecipe', start);
    const body = searchSource.slice(start, end);
    expect(body).toMatch(/servings: materialized\.servings, defaultServingId: materialized\.defaultServingId/);
  });

  it('never calls addDiaryFood with a literal 100 from the FoodSearchScreen onSelect handler', () => {
    const start = shellSource.indexOf('<FoodSearchScreen');
    const end = shellSource.indexOf('<RegisterMealScreen', start);
    const body = shellSource.slice(start, end);
    expect(body).not.toMatch(/addDiaryFood\([^)]*,\s*100\)/);
  });

  it('defers the non-recipe pick to FoodQuantityModal instead of writing immediately on selection', () => {
    const onSelectStart = shellSource.indexOf('onSelect={(food) => {');
    const onSelectEnd = shellSource.indexOf('overlay={(', onSelectStart);
    const body = shellSource.slice(onSelectStart, onSelectEnd);
    expect(body).toMatch(/if \(food\.origin === 'recipe'\) \{/);
    expect(body).toMatch(/setFoodQuantityPick\(food\);/);
    // The non-recipe branch must not itself call addDiaryFood — only FoodQuantityModal's onConfirm may.
    expect(body).not.toMatch(/addDiaryFood\(/);
  });

  it('FoodQuantityModal is rendered in the overlay slot alongside RecipeQuantityModal, both inside one Modal', () => {
    const overlayStart = shellSource.indexOf('overlay={(');
    const overlayEnd = shellSource.indexOf('/>\n\n      <RegisterMealScreen', overlayStart);
    const body = shellSource.slice(overlayStart, overlayEnd >= 0 ? overlayEnd : overlayStart + 2000);
    expect(body).toMatch(/<RecipeQuantityModal/);
    expect(body).toMatch(/<FoodQuantityModal/);
    expect(body).toMatch(/visible=\{foodQuantityPick != null\}/);
    expect(body).toMatch(/pick=\{foodQuantityPick\}/);
  });

  it('FoodQuantityModal onConfirm writes the resolved grams variable, never a literal, and always via the existing addDiaryFood path', () => {
    const confirmStart = shellSource.indexOf('<FoodQuantityModal');
    const confirmEnd = shellSource.indexOf('/>', shellSource.indexOf('onConfirm={(grams) => {', confirmStart));
    const body = shellSource.slice(confirmStart, confirmEnd);
    expect(body).toMatch(/void addDiaryFood\(uid, diaryDate, diaryFoodTarget, source, foodQuantityPick\.foodId, grams\)/);
    expect(body).not.toMatch(/addDiaryFood\([^)]*,\s*100\)/);
  });

  it('closes the panel synchronously in the same handler that fires the write, preventing a double-tap from logging twice', () => {
    // Same mechanism RecipeQuantityModal's onConfirm already relies on:
    // `setFoodQuantityPick(null)` makes `visible={foodQuantityPick != null}`
    // false on the very same tick as the write, so the button that was
    // just pressed is gone before a second tap could land.
    const confirmStart = shellSource.indexOf('onConfirm={(grams) => {', shellSource.indexOf('<FoodQuantityModal'));
    const confirmEnd = shellSource.indexOf('}}', confirmStart);
    const body = shellSource.slice(confirmStart, confirmEnd);
    expect(body).toMatch(/setFoodQuantityPick\(null\); setDiaryFoodTarget\(null\);/);
  });

  it('onClose also clears foodQuantityPick, so cancelling never leaves a stale pick to write later', () => {
    const closeMatch = shellSource.match(/<FoodQuantityModal[\s\S]*?onClose=\{\(\) => \{ ([^}]*) \}\}/);
    expect(closeMatch?.[1]).toMatch(/setFoodQuantityPick\(null\)/);
    expect(closeMatch?.[1]).toMatch(/setDiaryFoodTarget\(null\)/);
  });

  it('FoodQuantityModal resolves the default natural unit (not a hardcoded 100) when the pick has servings', () => {
    expect(modalSource).toMatch(/const defaultUnit = pick \? resolveDefaultServingUnit\(pick\.servings, pick\.defaultServingId\) : null;/);
    expect(modalSource).toMatch(/setGramsText\(defaultGrams != null \? String\(defaultGrams\) : '100'\)/);
  });

  it('falls back to a plain editable 100 g only when the food has no servable unit, never as an automatic write', () => {
    // '100' only ever seeds the TextInput's state — there is no write call anywhere in this file.
    expect(modalSource).not.toMatch(/addDiaryFood/);
    expect(modalSource).toMatch(/const \[gramsText, setGramsText\] = useState\('100'\);/);
  });

  it('only calls onConfirm after explicit user confirmation, gated on valid grams', () => {
    expect(modalSource).toMatch(/onPress=\{\(\) => \{ if \(gramsValid\) onConfirm\(gramsValue\); \}\}/);
    expect(modalSource).toMatch(/disabled=\{!gramsValid\}/);
  });

  it('offers unit pills (servable units + a plain grams option) exactly like RegisterMealScreen\'s own grams step', () => {
    expect(modalSource).toMatch(/servableUnits\.map\(\(unit\) => \(/);
    expect(modalSource).toMatch(/onPress=\{\(\) => selectServingUnit\(unit\)\}/);
    expect(modalSource).toMatch(/onPress=\{\(\) => selectServingUnit\(null\)\}/);
    expect(modalSource).toMatch(/value=\{gramsText\} onChangeText=\{setGramsText\}/);
  });

  it('renders through the shared NuPanel overlay, never a second native <Modal>', () => {
    expect(modalSource).not.toMatch(/<Modal\b/);
    expect(modalSource).toMatch(/<NuPanel visible=\{visible\} onClose=\{onClose\}>/);
  });

  it('reuses the same unit-resolution and math utilities RegisterMealScreen already uses, instead of a divergent implementation', () => {
    expect(modalSource).toMatch(/import \{ resolveDefaultServingUnit, servingGrams \} from '\.\.\/\.\.\/nutrition\/catalog\/servings'/);
    expect(modalSource).toMatch(/import \{ nutrientsForGrams \} from '\.\.\/\.\.\/nutrition\/catalog\/math'/);
  });
});
