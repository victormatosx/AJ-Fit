import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/screens/nutrition/CreateRecipeScreen.tsx', 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/.*$/gm, '');

describe('CreateRecipeScreen', () => {
  it('embeds ingredient search on this same page — never opens FoodSearchScreen as a separate screen', () => {
    // Same UX as RegisterMealScreen's embedded search: this screen only
    // imports FoodSearchScreen for its `NutritionFoodPick` type, never
    // renders the component itself.
    expect(source).not.toMatch(/<FoodSearchScreen/);
    expect(source).toMatch(/import type \{ NutritionFoodPick \} from '\.\/FoodSearchScreen'/);
    expect(source).toMatch(/import \{ listCustomFoods \} from '\.\.\/\.\.\/services\/nutritionFoods'/);
    expect(source).toMatch(/import \{ createLocalFoodLogSearchProvider \} from '\.\.\/\.\.\/services\/foodLogCatalog'/);
    expect(source).toMatch(/localFoodLogSearchProvider\.search\(query/);
  });

  it('shows kcal/protein/"per 100 g" on search results and adds the tapped food straight to the ingredient list', () => {
    expect(source).toMatch(/kcal=\{food\.nutritionPer100g\.kcal\} proteinG=\{food\.nutritionPer100g\.proteinG\} per100g/);
    expect(source).toMatch(/const addIngredient = \(food: NutritionFoodPick\) => \{[\s\S]*?setIngredients\(\(prev\) => \[\.\.\.prev, \{ \.\.\.food, grams: '100' \}\]\);/);
  });

  it('excludes already-added ingredients from search results', () => {
    expect(source).toMatch(/const addedFoodIds = useMemo\(\(\) => new Set\(ingredients\.map\(\(item\) => item\.foodId\)\), \[ingredients\]\);/);
    expect(source).toMatch(/!addedFoodIds\.has\(food\.id\)/);
  });

  it('uses logging-catalog origin and supports safe pagination/recent boosts', () => {
    expect(source).toMatch(/origin="food_log"/);
    expect(source).toMatch(/origin: 'food_log'/);
    expect(source).toMatch(/recentIds: recentIdSet/);
    expect(source).toMatch(/cursor, favoriteIds: favoriteIdSet, recentIds: recentIdSet/);
  });

  it('hides the search once MAX_INGREDIENTS is reached, showing the cap message instead', () => {
    expect(source).toMatch(/ingredients\.length < MAX_INGREDIENTS \? \(/);
  });

  it('derives the whole breakdown from calculateRecipeBreakdown — never a client-typed macro field', () => {
    expect(source).toMatch(/calculateRecipeBreakdown\(\{/);
    // No raw numeric TextInput bound to anything that looks like a macro value.
    expect(source).not.toMatch(/onChangeText=\{setKcal\}|onChangeText=\{setProtein/);
  });

  it('lets each ingredient\'s grams be edited inline and removed, without a separate edit mode', () => {
    expect(source).toMatch(
      /onChangeText=\{\(v\) => setIngredients\(\(prev\) => prev\.map\(\(ing, i\) => \(i === index \? \{ \.\.\.ing, grams: v \} : ing\)\)\)\}/,
    );
    expect(source).toMatch(/onPress=\{\(\) => setIngredients\(\(prev\) => prev\.filter\(\(_, i\) => i !== index\)\)\}/);
  });

  it('caps ingredients at MAX_INGREDIENTS (the documented recipe safety limit) and disables adding past it', () => {
    expect(source).toMatch(/const MAX_INGREDIENTS = 6;/);
    expect(source).toMatch(/ingredients\.length < MAX_INGREDIENTS \? \(/);
    expect(source).toMatch(/t\('recipe\.maxIngredients', \{ count: MAX_INGREDIENTS \}\)/);
  });

  it('shows total ingredient weight, final-weight input with a fallback note, and the per100g derivation', () => {
    expect(source).toMatch(/t\('recipe\.totalWeight'\)/);
    expect(source).toMatch(/value=\{finalWeightText\}\s*onChangeText=\{setFinalWeightText\}/);
    expect(source).toMatch(/breakdown\.usedIngredientWeightFallback \? \(/);
    expect(source).toMatch(/t\('recipe\.finalWeightFallback', \{ grams: Math\.round\(breakdown\.totalIngredientWeightG\) \}\)/);
    expect(source).toMatch(/<NutrientRow label=\{t\('recipe\.per100g'\)\} values=\{breakdown\.per100g\} \/>/);
  });

  it('shows per-serving macros only when the breakdown actually has them (servings was valid)', () => {
    expect(source).toMatch(/\{breakdown\.perServing \? \(/);
    expect(source).toMatch(/<NuCap>\{t\('recipe\.perServing'\)\}<\/NuCap>/);
    expect(source).toMatch(/Math\.round\(breakdown\.perServing\.kcal\)/);
    expect(source).toMatch(/breakdown\.perServing\.proteinG\.toFixed\(1\)/);
  });

  it('passes finalWeightG/servings through to createNutritionRecipe only when actually provided', () => {
    const saveStart = source.indexOf('const handleSave');
    const saveEnd = source.indexOf('};', saveStart);
    const saveBody = source.slice(saveStart, saveEnd);
    expect(saveBody).toMatch(/\.\.\.\(hasFinalWeight \? \{ finalWeightG: finalWeightValue \} : \{\}\)/);
    expect(saveBody).toMatch(/\.\.\.\(hasServings \? \{ servings: servingsValue \} : \{\}\)/);
  });
});
