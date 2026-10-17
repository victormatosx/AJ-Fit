import { readFileSync } from 'node:fs';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MealCard } from '../MealCard';
import { foodNames } from '../../../nutrition/ui/planView';
import type { NutritionMeal } from '../../../types/nutrition';

const expansion = vi.hoisted(() => ({ optionId: null as string | null }));
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useState: () => [expansion.optionId, (value: string | null) => { expansion.optionId = value; }],
}));
vi.mock('react-native', () => ({ Pressable: 'Pressable', Text: 'Text', View: 'View' }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({
  t: (key: string, values?: { count: number }) => values ? `${key}:${values.count}` : key,
}) }));
vi.mock('../../ui/Icon', () => ({ Icon: 'Icon' }));
vi.mock('../NuKit', () => ({ NU: {}, NuButton: 'NuButton', NuCap: 'NuCap' }));

beforeEach(() => { expansion.optionId = null; });

type Node = React.ReactElement<Record<string, unknown>>;
function nodes(tree: unknown): Node[] {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!React.isValidElement<Record<string, unknown>>(tree)) return [];
  return [tree, ...nodes(tree.props.children)];
}
function foodLabels(tree: unknown, meal: NutritionMeal) {
  return nodes(tree).filter((n) => n.type === 'Text' && meal.options[0].foods.some((food) => food.name === n.props.children)).map((n) => n.props.children);
}

const source = readFileSync('src/components/nutrition/MealCard.tsx', 'utf8');

/**
 * Regression for the diet-quality-v3 crash: a freshly generated plan's items
 * are free-form AI names with no `foodId`/`sourceId` (never resolved against
 * `nutritionFoods`) — `formatFoodDisplayName` (catalog-only TACO/TBCA
 * comma-chain reordering) must never be applied to them, since that's what
 * threw `Cannot read property 'trim' of undefined` once a stale build no
 * longer matched the frontend's free-form contract.
 */
function freeFormMeal(): NutritionMeal {
  return {
    slot: 'lunch',
    recommendedOptionId: 'lunch-1',
    options: [
      {
        id: 'lunch-1',
        foods: [
          { name: 'Arroz branco cozido', quantity: 150, unit: 'g', preparationNote: 'cozido', estimatedNutrition: { kcal: 190, proteinG: 4, carbsG: 41, fatG: 0.4, fiberG: 1 }, allergens: [] },
          { name: 'Feijão carioca cozido', quantity: 100, unit: 'g', preparationNote: '', estimatedNutrition: { kcal: 76, proteinG: 5, carbsG: 14, fatG: 0.5, fiberG: 6 }, allergens: [] },
        ],
        totals: { kcal: 266, proteinG: 9, carbsG: 55, fatG: 0.9, fiberG: 7 },
      },
    ],
  };
}

describe('MealCard — free-form plan items, no catalog dependency', () => {
  it('renders the AI\'s own names, with no foodId/sourceId on the items', () => {
    const meal = freeFormMeal();
    for (const food of meal.options[0].foods) {
      expect('foodId' in food).toBe(false);
      expect('sourceId' in food).toBe(false);
    }
    expect(foodNames(meal)).toBe('Arroz branco cozido, Feijão carioca cozido');
  });

  it('never throws for a plan item name that a catalog-oriented formatter would mishandle', () => {
    const meal = freeFormMeal();
    meal.options[0].foods[0].name = 'Omelete, 2 ovos, com queijo';
    expect(() => foodNames(meal)).not.toThrow();
    expect(foodNames(meal)).toContain('Omelete, 2 ovos, com queijo');
  });

  it('never calls formatFoodDisplayName — that formatter is catalog-only', () => {
    expect(source).not.toMatch(/formatFoodDisplayName/);
  });
});

describe('Próxima Refeição inline food list', () => {
  function manyFoods() {
    const meal = freeFormMeal();
    meal.options[0].foods.push({ ...meal.options[0].foods[0], name: 'Salada de tomate' }, { ...meal.options[0].foods[1], name: 'Frango grelhado' });
    return meal;
  }

  it('initially shows two bullet items and expands/collapses without opening meal details', () => {
    const meal = manyFoods(), onPress = vi.fn();
    const render = () => MealCard({ meal, variant: 'next', onPress });
    let tree = render();
    expect(foodLabels(tree, meal)).toEqual(meal.options[0].foods.slice(0, 2).map((f) => f.name));
    let toggle = nodes(tree).find((n) => n.type === 'Pressable')!;
    expect(toggle.props.accessibilityState).toEqual({ expanded: false });
    expect(nodes(tree).some((n) => n.props.children === ' (+2)')).toBe(true);
    expect(toggle.props.accessibilityLabel).toBe('home.nextMeal.showAllFoods:2');
    expect(nodes(toggle).filter((n) => n.type === 'Text')).toHaveLength(0);
    expect(nodes(tree).some((n) => n.type === 'Icon' && n.props.name === 'chevron-down')).toBe(true);
    expect((toggle.props.style as { position: string }).position).toBe('absolute');
    (toggle.props.onPress as () => void)(); tree = render();
    expect(foodLabels(tree, meal)).toEqual(meal.options[0].foods.map((f) => f.name));
    expect(nodes(tree).some((n) => n.props.children === ' (+2)')).toBe(false);
    expect(onPress).not.toHaveBeenCalled();
    toggle = nodes(tree).find((n) => n.type === 'Pressable')!;
    expect(toggle.props.accessibilityState).toEqual({ expanded: true });
    (toggle.props.onPress as () => void)(); tree = render();
    expect(foodLabels(tree, meal)).toHaveLength(2);
    (nodes(tree).find((n) => n.type === 'NuButton')!.props.onPress as () => void)();
    expect(onPress).toHaveBeenCalledOnce();
  });

  it('lets food, macros and blank areas reach the card toggle, while the name chip and detail button stay independent', () => {
    const meal = manyFoods(), onPress = vi.fn();
    const tree = MealCard({ meal, variant: 'next', onPress });
    const toggle = nodes(tree).find((n) => n.type === 'Pressable')!;
    const foodArea = nodes(tree).find((n) => n.props.pointerEvents === 'none' && foodLabels(n, meal).length === 2)!;
    expect(foodArea).toBeDefined();
    const macros = nodes(tree).find((n) => n.props.pointerEvents === 'none' && nodes(n).some((c) => c.props.children === '266'));
    expect(macros).toBeDefined();
    const chip = nodes(tree).find((n) => n.props.onStartShouldSetResponder)!;
    expect((chip.props.onStartShouldSetResponder as () => boolean)()).toBe(true);
    expect(nodes(chip).some((n) => n.props.children === 'mealSlots.lunch')).toBe(true);
    expect(expansion.optionId).toBeNull();
    (toggle.props.onPress as () => void)();
    const expandedId = expansion.optionId;
    const detail = nodes(tree).find((n) => n.type === 'NuButton')!;
    expect(nodes(toggle).includes(detail)).toBe(false);
    (detail.props.onPress as () => void)();
    expect(onPress).toHaveBeenCalledOnce(); expect(expansion.optionId).toBe(expandedId);
  });

  it('omits expansion when there are at most two foods and keeps long names untruncated', () => {
    const meal = freeFormMeal();
    meal.options[0].foods[0].name = 'Omelete, 2 ovos, com queijo e ervas frescas';
    const tree = MealCard({ meal, variant: 'next', onPress: vi.fn() });
    expect(nodes(tree).filter((n) => n.type === 'Pressable')).toHaveLength(0);
    expect(foodLabels(tree, meal)).toHaveLength(2);
    const first = nodes(tree).find((n) => n.props.children === meal.options[0].foods[0].name)!;
    expect(first.props.numberOfLines).toBeUndefined();
  });

  it('resets the visible preview for a different option and preserves the list variant', () => {
    const meal = manyFoods();
    let tree = MealCard({ meal, variant: 'next', onPress: vi.fn() });
    (nodes(tree).find((n) => n.type === 'Pressable')!.props.onPress as () => void)();
    meal.options[0].id = 'new-option'; meal.recommendedOptionId = 'new-option';
    tree = MealCard({ meal, variant: 'next', onPress: vi.fn() });
    expect(foodLabels(tree, meal)).toHaveLength(2);
    tree = MealCard({ meal, variant: 'list', onPress: vi.fn() });
    expect(nodes(tree).some((n) => n.props.children === foodNames(meal))).toBe(true);
    expect(nodes(tree).filter((n) => n.type === 'Pressable')).toHaveLength(1);
  });
});
