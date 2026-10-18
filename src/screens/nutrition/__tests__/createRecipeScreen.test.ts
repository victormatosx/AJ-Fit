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

  it('shows kcal/protein/"per 100 g" on search results and opens the same add-grams quantity step RegisterMealScreen uses', () => {
    expect(source).toMatch(/kcal=\{food\.nutritionPer100g\.kcal\} proteinG=\{food\.nutritionPer100g\.proteinG\} per100g/);
    expect(source).toMatch(/const openAddIngredient = \(food: NutritionFoodPick\) => \{[\s\S]*?setGramsStep\(food\);/);
    expect(source).toMatch(/const confirmAddIngredient = \(\) => \{[\s\S]*?setIngredients\(\(prev\) => \[\.\.\.prev, \{ \.\.\.gramsStep, grams: gramsText \}\]\);/);
    // Same component/behavior as RegisterMealScreen's grams step: keyboard dismissed on open+confirm, NuPanel sheet, serving-unit pills.
    expect(source).toMatch(/<NuPanel visible=\{gramsStep != null\} avoidKeyboard/);
    expect(source).toMatch(/servableUnits\.length > 0/);
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

  it('never limits the number of ingredients', () => {
    expect(source).not.toMatch(/MAX_INGREDIENTS/);
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

  it('always shows the embedded ingredient search, never gated behind a toggle', () => {
    expect(source).not.toMatch(/showIngredientSearch/);
    expect(source).not.toMatch(/recipe\.addIngredient/);
  });

  it('labels the name and description fields and keeps their placeholders', () => {
    expect(source).toMatch(/value=\{name\}\s*onChangeText=\{setName\}\s*placeholder=\{t\('recipe\.namePlaceholder'\)\}/);
    expect(source).toMatch(/value=\{description\}\s*onChangeText=\{setDescription\}\s*placeholder=\{t\('recipe\.descriptionPlaceholder'\)\}/);
    expect(source).toContain("<Text style={styles.fieldLabel}>{t('recipe.name')}</Text>");
    expect(source).toContain("<Text style={styles.fieldLabel}>{t('recipe.description')}</Text>");
  });

  it('shows ingredient weight without a final-weight input or duplicate per100g summary', () => {
    expect(source).toMatch(/t\('recipe\.totalWeight'\)/);
    expect(source).toMatch(/Math\.round\(breakdown\.totalIngredientWeightG\)/);
    expect(source).not.toMatch(/finalWeight/);
    expect(source).not.toMatch(/recipe\.per100g|recipe\.nutritionSubtitle/);
  });

  it('shows per-serving macros only when the breakdown actually has them (servings was valid)', () => {
    expect(source).toMatch(/\{breakdown\?\.perServing \? \(/);
    expect(source).toMatch(/<NuCap>\{t\('recipe\.perServing'\)\}<\/NuCap>/);
    expect(source).toMatch(/Math\.round\(breakdown\.perServing\.kcal\)/);
    expect(source).toMatch(/breakdown\.perServing\.proteinG\.toFixed\(1\)/);
  });

  it('saves recipes with ingredient-based weight and optional servings', () => {
    const saveStart = source.indexOf('const handleSave');
    const saveEnd = source.indexOf('};', saveStart);
    const saveBody = source.slice(saveStart, saveEnd);
    expect(saveBody).not.toMatch(/finalWeightG/);
    expect(saveBody).toMatch(/\.\.\.\(hasServings \? \{ servings: servingsValue \} : \{\}\)/);
  });
});
