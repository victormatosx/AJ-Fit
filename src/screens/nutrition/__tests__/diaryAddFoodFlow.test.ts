import React from 'react';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { foodPickOriginToDiarySource } from '../../../nutrition/ui/diaryModel';

// Execute the real shell's JSX handlers, with persistence controlled by the test.
// This covers the selected date/slot and asynchronous writes without Firebase or a native renderer.
const source = ts.createSourceFile('shell.tsx', readFileSync('src/screens/nutrition/NutritionShell.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let diaryJsx = '';
const helpers: string[] = [];
function visit(node: ts.Node) {
  if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(source) === 'NutritionDiaryScreen') diaryJsx = node.getText(source);
  if (ts.isVariableDeclaration(node) && ['openDiaryFoodSearch', 'closeDiaryFoodSearch'].includes(node.name.getText(source))) helpers.push(`const ${node.getText(source)};`);
  ts.forEachChild(node, visit);
}
visit(source);
function compile(code: string) {
  return ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText;
}
type Node = React.ReactElement<Record<string, unknown>>;
function nodes(tree: unknown): Node[] {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!React.isValidElement<Record<string, unknown>>(tree)) return [];
  return [tree, ...nodes(tree.props.children), ...nodes(tree.props.overlay)];
}
function flow() {
  let resolveWrite!: () => void, rejectWrite!: (reason?: unknown) => void;
  const addDiaryFood = vi.fn(() => new Promise<void>((resolve, reject) => { resolveWrite = resolve; rejectWrite = reject; }));
  const values = {
    React, NutritionDiaryScreen: 'Diary', FoodSearchScreen: 'Search', RecipeQuantityModal: 'RecipeQuantity', FoodQuantityModal: 'FoodQuantity',
    uid: 'user-1', diaryDate: '2026-10-15', diaryVisible: true, diaryDay: null, diaryLoaded: true, plan: null,
    profile: { mealSlots: ['breakfast', 'lunch'] },
    diaryFoodTarget: null as string | null,
    foodQuantityPick: null as { origin: string; foodId: string } | null,
    recipeQuantityPick: null as { origin: string; foodId: string } | null,
    recipeQuantityRecipe: null as unknown,
    addingDiaryFood: false, diaryAddInFlight: { current: false },
    favoriteFoodIds: [], favoriteRecipeIds: [], recentFoodIds: [],
    handleToggleFavoriteFood: vi.fn(), handleToggleFavoriteRecipe: vi.fn(),
    Keyboard: { dismiss: vi.fn() }, Alert: { alert: vi.fn() }, t: (key: string) => key,
    foodPickOriginToDiarySource, addDiaryFood, trackNutritionEvent: vi.fn(),
    loadNutritionRecipe: vi.fn(async () => ({ servings: 2 })),
    setDiaryFoodTarget: (slot: string | null) => { values.diaryFoodTarget = slot; },
    setFoodQuantityPick: (pick: { origin: string; foodId: string } | null) => { values.foodQuantityPick = pick; },
    setRecipeQuantityPick: (pick: { origin: string; foodId: string } | null) => { values.recipeQuantityPick = pick; },
    setRecipeQuantityRecipe: (recipe: unknown) => { values.recipeQuantityRecipe = recipe; },
    setAddingDiaryFood: (value: boolean) => { values.addingDiaryFood = value; },
    setDiaryVisible: (value: boolean) => { values.diaryVisible = value; },
  };
  const context = vm.createContext(values);
  vm.runInContext(compile(helpers.join('\n')), context);
  function render() {
    return vm.runInContext(compile(`(${diaryJsx});`), context) as Node;
  }
  function child(type: string) {
    return nodes(render().props.overlay).find((node) => node.type === type)!;
  }
  function open(slot = 'lunch') {
    (render().props.onAddFood as (slot: string) => void)(slot);
  }
  function select(origin = 'food_log') {
    (child('Search').props.onSelect as (pick: unknown) => void)({ origin, foodId: 'food-1', name: 'Ovo', nutritionPer100g: { kcal: 155 } });
  }
  return { values, render, child, open, select, resolve: () => resolveWrite(), reject: () => rejectWrite(new Error('offline')) };
}
const flush = async () => { await new Promise((resolve) => setImmediate(resolve)); };

describe('Diário: add food sheet integration', () => {
  it('opens an embedded sheet for the correct meal without closing the Diary', () => {
    const f = flow(); f.open();
    expect(f.values.diaryVisible).toBe(true);
    expect(f.child('Search').props).toMatchObject({ visible: true, presentation: 'sheet', variant: 'nutrition', catalog: 'logging', includeRecipes: true });
    expect(f.values.diaryFoodTarget).toBe('lunch');
  });

  it('defers saving until quantity confirmation and writes the selected date, source, food and grams', async () => {
    const f = flow(); f.open(); f.select();
    expect(f.values.addDiaryFood).not.toHaveBeenCalled();
    const confirm = f.child('FoodQuantity').props.onConfirm as (grams: number) => void;
    confirm(50); confirm(50);
    expect(f.values.addDiaryFood).toHaveBeenCalledExactlyOnceWith('user-1', '2026-10-15', 'lunch', 'food_log_catalog', 'food-1', 50);
    expect(f.values.addingDiaryFood).toBe(true);
    expect(f.values.diaryFoodTarget).toBe('lunch');
    f.resolve(); await flush();
    expect(f.values.diaryVisible).toBe(true);
    expect(f.values.diaryFoodTarget).toBeNull();
    expect(f.values.foodQuantityPick).toBeNull();
    expect(f.values.addingDiaryFood).toBe(false);
    expect(f.values.trackNutritionEvent).toHaveBeenCalledOnce();
  });

  it('retains the selection after a save failure and allows retrying', async () => {
    const f = flow(); f.open(); f.select('custom');
    (f.child('FoodQuantity').props.onConfirm as (g: number) => void)(35);
    f.reject(); await flush();
    expect(f.values.Alert.alert).toHaveBeenCalledWith('diary.addError');
    expect(f.values.diaryFoodTarget).toBe('lunch');
    expect(f.values.foodQuantityPick?.foodId).toBe('food-1');
    expect(f.values.addingDiaryFood).toBe(false);
    (f.child('FoodQuantity').props.onConfirm as (g: number) => void)(35);
    expect(f.values.addDiaryFood).toHaveBeenLastCalledWith('user-1', '2026-10-15', 'lunch', 'custom_food', 'food-1', 35);
    f.resolve(); await flush(); expect(f.values.diaryFoodTarget).toBeNull();
  });

  it('quantity cancellation and Android back return to search, then dismiss the sheet without closing the Diary', () => {
    const f = flow(); f.open('breakfast'); f.select();
    (f.child('FoodQuantity').props.onClose as () => void)();
    expect(f.values.foodQuantityPick).toBeNull(); expect(f.values.diaryFoodTarget).toBe('breakfast');
    f.select(); (f.render().props.onDismissOverlay as () => void)();
    expect(f.values.foodQuantityPick).toBeNull(); expect(f.values.diaryFoodTarget).toBe('breakfast');
    (f.render().props.onDismissOverlay as () => void)();
    expect(f.values.diaryFoodTarget).toBeNull(); expect(f.values.diaryVisible).toBe(true);
    expect(f.values.addDiaryFood).not.toHaveBeenCalled();
  });

  it('blocks dismissal while saving and preserves recipe logging with its resolved grams', async () => {
    const f = flow(); f.open(); f.select('recipe'); await flush();
    expect(f.values.recipeQuantityRecipe).toEqual({ servings: 2 });
    const quantity = f.child('RecipeQuantity');
    (quantity.props.onConfirm as (g: number) => void)(150);
    (f.render().props.onDismissOverlay as () => void)();
    (f.child('RecipeQuantity').props.onClose as () => void)();
    expect(f.values.diaryFoodTarget).toBe('lunch'); expect(f.values.recipeQuantityPick).not.toBeNull();
    expect(f.values.addDiaryFood).toHaveBeenCalledExactlyOnceWith('user-1', '2026-10-15', 'lunch', 'recipe', 'food-1', 150);
    f.resolve(); await flush(); expect(f.values.recipeQuantityPick).toBeNull();
  });
});
