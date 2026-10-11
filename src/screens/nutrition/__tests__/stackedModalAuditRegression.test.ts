import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const strip = (path: string) => readFileSync(path, 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/.*$/gm, '');

const createCustomFoodSource = strip('src/screens/nutrition/CreateCustomFoodScreen.tsx');
const foodSearchSource = strip('src/screens/nutrition/FoodSearchScreen.tsx');
const recipeQuantitySource = strip('src/screens/nutrition/RecipeQuantityModal.tsx');
const diarySource = strip('src/screens/nutrition/NutritionDiaryScreen.tsx');
const shellSource = strip('src/screens/nutrition/NutritionShell.tsx');

/**
 * Preventive audit regression: a sweep of every Modal/overlay in the
 * Nutrition feature (prompted by the MealDetailsScreen/MealFeedbackSheet
 * stacked-Modal bug fixed earlier) found the SAME anti-pattern — two
 * independent native `<Modal>`s able to be `visible`/mounted at once —
 * in three more places:
 *
 *   1. `FoodSearchScreen` rendered `<CreateCustomFoodScreen>` (its own
 *      `pageSheet` Modal) nested inside FoodSearchScreen's own `pageSheet`
 *      Modal, reachable via the "no results, cadastrar alimento" CTA.
 *   2. `NutritionShell` rendered the Diary's `FoodSearchScreen`
 *      (`pageSheet`) and `RecipeQuantityModal` (`transparent`) as
 *      top-level siblings, both `visible` at once as soon as a recipe is
 *      tapped in search (`diaryFoodTarget` is intentionally kept set so
 *      the slot survives until quantity is confirmed).
 *   3. `NutritionDiaryScreen` rendered `EditGramsSheet` and the "move
 *      meal" picker — both `<Modal transparent>` — nested inside its own
 *      `pageSheet` Modal.
 *
 * Fix (same recipe as MealFeedbackSheet/MealAlternativeResultScreen):
 * each inner screen no longer owns a `<Modal>` — it returns `null` while
 * `!visible` and otherwise renders a plain absolutely-positioned View,
 * hosted inside the single remaining Modal via an `overlay` prop (or,
 * for NutritionDiaryScreen, inline). There is now exactly one native
 * Modal per flow, so there is nothing left to stack/corrupt.
 */
describe('Nutrition feature: no stacked native Modals (preventive audit)', () => {
  it('CreateCustomFoodScreen owns no native Modal and fully unmounts while closed', () => {
    expect(createCustomFoodSource).not.toMatch(/<Modal\b/);
    expect(createCustomFoodSource).toMatch(/if \(!visible\) return null;/);
  });

  it('FoodSearchScreen has exactly one Modal and hosts CreateCustomFoodScreen plus the caller overlay inside it', () => {
    expect(foodSearchSource.match(/<Modal\b/g)?.length).toBe(1);
    const modalStart = foodSearchSource.indexOf('<Modal');
    const modalEnd = foodSearchSource.indexOf('</Modal>');
    const modalBody = foodSearchSource.slice(modalStart, modalEnd);
    expect(modalBody).toMatch(/<CreateCustomFoodScreen/);
    expect(modalBody).toMatch(/\{overlay\}/);
  });

  it('RecipeQuantityModal owns no native Modal and fully unmounts while closed', () => {
    expect(recipeQuantitySource).not.toMatch(/<Modal\b/);
    expect(recipeQuantitySource).toMatch(/if \(!visible\) return null;/);
  });

  it('NutritionShell wires RecipeQuantityModal through the Diary FoodSearchScreen.overlay, not as a top-level Modal sibling', () => {
    const foodSearchCallStart = shellSource.indexOf('<FoodSearchScreen');
    const foodSearchCallEnd = shellSource.indexOf('<RegisterMealScreen', foodSearchCallStart);
    expect(foodSearchCallStart).toBeGreaterThan(-1);
    expect(foodSearchCallEnd).toBeGreaterThan(foodSearchCallStart);
    const body = shellSource.slice(foodSearchCallStart, foodSearchCallEnd);
    expect(body).toMatch(/overlay=\{\(/);
    expect(body).toMatch(/<RecipeQuantityModal/);
    // Only one FoodSearchScreen call site in the shell, and no top-level
    // RecipeQuantityModal sibling left outside it.
    expect(shellSource.match(/<FoodSearchScreen/g)?.length).toBe(1);
    expect(shellSource.match(/<RecipeQuantityModal/g)?.length).toBe(1);
  });

  it('NutritionDiaryScreen has exactly one Modal; EditGramsSheet and the move-meal picker are plain overlays inside it', () => {
    expect(diarySource.match(/<Modal\b/g)?.length).toBe(1);
    expect(diarySource).toMatch(/function EditGramsSheet\(/);
    const editGramsStart = diarySource.indexOf('function EditGramsSheet(');
    const editGramsEnd = diarySource.indexOf('export function NutritionDiaryScreen', editGramsStart);
    expect(diarySource.slice(editGramsStart, editGramsEnd)).toMatch(/if \(!visible\) return null;/);
    // The "move meal" overlay is now a conditional plain View, not a Modal.
    expect(diarySource).toMatch(/\{moving != null \? \(/);
    expect(diarySource).not.toMatch(/visible=\{moving != null\}/);
  });
});
