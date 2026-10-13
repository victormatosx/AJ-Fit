import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(path, 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/.*$/gm, '');

const foodRow = read('src/components/nutrition/FoodRow.tsx');
const foodSearch = read('src/screens/nutrition/FoodSearchScreen.tsx');
const registerMeal = read('src/screens/nutrition/RegisterMealScreen.tsx');
const createRecipe = read('src/screens/nutrition/CreateRecipeScreen.tsx');
const favorites = read('src/screens/nutrition/NutritionFoodFavoritesScreen.tsx');
const mealOptionFavorites = read('src/screens/nutrition/NutritionFavoritesScreen.tsx');
const shell = read('src/screens/nutrition/NutritionShell.tsx');

describe('food and recipe favorites UI', () => {
  it('renders an accessible empty/filled heart as a separate action from the row press', () => {
    expect(foodRow).toMatch(/filled=\{Boolean\(favorited\)\}/);
    expect(foodRow).toMatch(/accessibilityLabel=\{favorited \? t\('favorites\.remove'\) : t\('favorites\.add'\)\}/);
    expect(foodRow).toMatch(/accessibilityState=\{\{ selected: Boolean\(favorited\) \}\}/);
    expect(foodRow).toMatch(/\{onPress \? \(\s*<Pressable[\s\S]*?\{details\}[\s\S]*?<\/Pressable>\s*\) : details\}/);
    expect(foodRow).toMatch(/\{heart\}\s*\{trailing \?\?/);
  });

  it('shows independent food and recipe hearts in FoodSearch', () => {
    expect(foodSearch).toMatch(/favorited=\{favoriteFoodIds\?\.includes\(food\.id\)\}/);
    expect(foodSearch).toMatch(/favorited=\{favoriteRecipeIds\?\.includes\(recipe\.id\)\}/);
    expect(foodSearch).toMatch(/onToggleFavoriteRecipe\(recipe\.id\)/);
  });

  it('shows food hearts in Register Meal and recipe ingredient search', () => {
    expect(registerMeal).toMatch(/favoriteFoodIds\?\.includes\(food\.id\)/);
    expect(registerMeal).toMatch(/onToggleFavoriteFood\(food\.id\)/);
    expect(createRecipe).toMatch(/favoriteFoodIds\?\.includes\(food\.id\)/);
    expect(createRecipe).toMatch(/onToggleFavoriteFood\(food\.id\)/);
  });

  it('has Foods and Recipes tabs with complete empty states', () => {
    expect(favorites).toContain("type Tab = 'foods' | 'recipes'");
    expect(favorites).toContain("t('favoriteItems.tabFoods')");
    expect(favorites).toContain("t('favoriteItems.tabRecipes')");
    expect(favorites).toContain("body={t('favoriteItems.emptyFoodsBody')}");
    expect(favorites).toContain("body={t('favoriteItems.emptyRecipesBody')}");
  });

  it('removes a food or recipe row immediately before persisting the toggle', () => {
    expect(favorites).toMatch(/setFoods\(\(current\) => current\.filter\(\(item\) => item\.foodId !== food\.foodId\)\);\s*onToggleFavoriteFood/);
    expect(favorites).toMatch(/setRecipes\(\(current\) => current\.filter\(\(item\) => item\.recipeId !== recipe\.recipeId\)\);\s*onToggleFavoriteRecipe/);
  });

  it('keeps an unavailable favorite visible and removable without rendering suspect macros', () => {
    expect(favorites).toContain("t('favoriteItems.unavailable')");
    expect(favorites).toMatch(/kcal=\{food\.nutritionPer100g\?\.kcal\}/);
    expect(favorites).toMatch(/per100g=\{food\.available\}/);
  });

  it('never reads a favorited meal option\'s food.estimatedNutrition.kcal directly — absent on a pre-diet-quality-v3 favorite', () => {
    expect(mealOptionFavorites).not.toMatch(/food\.estimatedNutrition\.kcal/);
    expect(mealOptionFavorites).toMatch(/kcal=\{planItemKcal\(food\)\}/);
  });

  it('wires optimistic state and rollback through every relevant screen', () => {
    expect(shell).toMatch(/setFavoriteFoodIds\(next\);\s*void toggleFavoriteFoodId/);
    expect(shell).toMatch(/setFavoriteRecipeIds\(next\);\s*void toggleFavoriteRecipeId/);
    expect(shell).toContain('favoriteFoodIds={favoriteFoodIds}');
    expect(shell).toContain('favoriteRecipeIds={favoriteRecipeIds}');
    expect(shell).toContain('<NutritionFoodFavoritesScreen');
    expect(shell).toContain('<NutritionFavoritesScreen');
  });
});
