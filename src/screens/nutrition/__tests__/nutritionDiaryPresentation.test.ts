import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NutritionDailyLogDoc } from '../../../services/nutritionDiary';
import type { NutritionLoggedFoodItem } from '../../../types/nutrition';
import { NutritionDiaryScreen } from '../NutritionDiaryScreen';

// Exercise the screen's callbacks and state transitions without a native runtime.
// Native primitives remain element nodes; React's element creation is unchanged.
const runtime = vi.hoisted(() => ({
  values: [] as unknown[], deps: [] as (readonly unknown[] | undefined)[], cursor: 0,
  effects: [] as (() => unknown)[], dirty: false,
  width: 390, fontScale: 1,
  alert: vi.fn(),
}));
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useState: <T,>(initial: T | (() => T)) => {
    const index = runtime.cursor++;
    if (!(index in runtime.values)) runtime.values[index] = typeof initial === 'function' ? (initial as () => T)() : initial;
    return [runtime.values[index], (value: T | ((previous: T) => T)) => {
      const next = typeof value === 'function' ? (value as (previous: T) => T)(runtime.values[index] as T) : value;
      if (!Object.is(next, runtime.values[index])) runtime.dirty = true;
      runtime.values[index] = next;
    }];
  },
  useEffect: (effect: () => unknown, deps?: readonly unknown[]) => {
    const index = runtime.cursor++;
    if (!deps || !runtime.deps[index] || deps.some((v, i) => !Object.is(v, runtime.deps[index]?.[i]))) runtime.effects.push(effect);
    runtime.deps[index] = deps;
  },
}));
vi.mock('react-native', () => ({
  Alert: { alert: runtime.alert }, Modal: 'Modal', Pressable: 'Pressable', ScrollView: 'ScrollView', Text: 'Text', View: 'View',
  useWindowDimensions: () => ({ width: runtime.width, fontScale: runtime.fontScale }),
}));
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView' }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({
  t: (key: string, values?: Record<string, unknown>) => values ? `${key}:${JSON.stringify(values)}` : key,
  i18n: { language: 'pt-BR' },
}) }));
vi.mock('../../../components/ui/Icon', () => ({ Icon: 'Icon' }));
vi.mock('../../../components/nutrition/NutritionPrimitives', () => ({ SkeletonBlock: 'SkeletonBlock' }));
vi.mock('../../../components/nutrition/NuKit', () => ({
  NU: { bg: 'bg', blue: 'blue', blueHi: 'blueHi', white: 'white', warn: 'warn', secondary: 'secondary', faint: 'faint' },
  NuButton: 'NuButton', NuNav: 'NuNav', NuPanel: 'NuPanel', NuSelectPill: 'NuSelectPill', NuSheetHeader: 'NuSheetHeader', NuStepper: 'NuStepper', NuRow: 'NuRow',
}));
vi.mock('../../../nutrition/ui/localDate', async (original) => ({
  ...await original<typeof import('../../../nutrition/ui/localDate')>(), todayLocalDate: () => '2026-10-16',
}));

type Node = React.ReactElement<Record<string, unknown>>;
type Props = React.ComponentProps<typeof NutritionDiaryScreen>;
function nodes(tree: React.ReactNode): Node[] {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!React.isValidElement<Record<string, unknown>>(tree)) return [];
  return [tree, ...nodes(tree.props.children as React.ReactNode)];
}
function named(tree: React.ReactNode, name: string) {
  return nodes(tree).filter((n) => n.type === name || typeof n.type === 'function' && n.type.name === name);
}
function press(node: Node) { (node.props.onPress as () => void)(); }
function content(tree: React.ReactNode): string {
  if (Array.isArray(tree)) return tree.map(content).join(' ');
  if (React.isValidElement<Record<string, unknown>>(tree)) return content(tree.props.children as React.ReactNode);
  return tree == null ? '' : String(tree);
}
function draw(props: Props): Node {
  for (let attempt = 0; attempt < 10; attempt++) {
    runtime.cursor = 0; runtime.dirty = false; runtime.effects = [];
    const tree = NutritionDiaryScreen(props) as Node;
    runtime.effects.forEach((effect) => effect());
    if (!runtime.dirty) return tree;
  }
  throw new Error('Unstable presentation state');
}
function row(tree: Node, slot: string) {
  return named(tree, 'Pressable').find((n) => n.props.accessibilityLabel === `mealSlots.${slot}`)!;
}
function localComponent(node: Node): Node {
  return (node.type as (props: Record<string, unknown>) => Node)(node.props);
}
const item = (id: string, grams: number, kcal: number) => ({
  id, grams, source: 'catalog_food', foodId: id, snapshot: { name: `Food ${id}`, kcal, proteinG: 12, carbsG: 30, fatG: 8, fiberG: 2 },
}) as NutritionLoggedFoodItem;
const totals = { kcal: 233, proteinG: 12, carbsG: 30, fatG: 8, fiberG: 2 };
function fixture(): Props {
  return {
    visible: true, localDate: '2026-10-16', dayLoaded: true,
    goals: { kcal: 3948, proteinG: 205, carbsG: 535, fatG: 110, fiberG: 55 },
    mealSlots: ['dinner', 'breakfast', 'morning_snack', 'lunch'],
    day: { totals, meals: [{ slot: 'breakfast', items: [item('tomato', 100, 15), item('cheese', 30, 95), item('bread', 50, 123)], totals, followedRecommendedOptionId: 'recommended' }] } as NutritionDailyLogDoc,
    onClose: vi.fn(), onPrevDay: vi.fn(), onNextDay: vi.fn(), onAddFood: vi.fn(), onEditGrams: vi.fn(), onRemove: vi.fn(), onMove: vi.fn(),
  };
}
function options(tree: Node, id = 'tomato') {
  press(named(tree, 'Pressable').find((n) => String(n.props.accessibilityLabel).startsWith('diary.foodActions:') && String(n.props.accessibilityLabel).includes(id))!);
}
function action(tree: Node, label: string) { press(named(tree, 'NuRow').find((n) => n.props.label === label)!); }

beforeEach(() => {
  runtime.values = []; runtime.deps = []; runtime.cursor = 0; runtime.dirty = false;
  runtime.width = 390; runtime.fontScale = 1; runtime.alert.mockReset();
});

describe('Diário Alimentar presentation', () => {
  it('sorts enabled slots without mutating configuration; opens the first recorded meal only', () => {
    const p = fixture(), tree = draw(p);
    expect(named(tree, 'Pressable').filter((n) => String(n.props.accessibilityLabel).startsWith('mealSlots.')).map((n) => n.props.accessibilityLabel))
      .toEqual(['mealSlots.breakfast', 'mealSlots.morning_snack', 'mealSlots.lunch', 'mealSlots.dinner']);
    expect(p.mealSlots).toEqual(['dinner', 'breakfast', 'morning_snack', 'lunch']);
    expect(row(tree, 'breakfast').props.accessibilityState).toEqual({ expanded: true });
    expect(row(tree, 'lunch').props.accessibilityState).toEqual({ expanded: false });
    expect(content(tree)).toContain('Food tomato');
    expect(content(tree)).toContain('diary.followedBadge');
  });

  it('keeps empty meals collapsed, distinguishes the next meal, and allows adding to any slot', () => {
    const p = { ...fixture(), day: null };
    let tree = draw(p);
    expect(content(tree)).not.toContain('diary.emptyMeal');
    expect(content(row(tree, 'breakfast'))).toContain('home.mealsToday.nextMeal');
    expect(content(row(tree, 'lunch'))).not.toContain('home.mealsToday.nextMeal');
    expect(named(row(tree, 'breakfast'), 'Icon').some((n) => n.props.name === 'check')).toBe(false);
    press(row(tree, 'lunch')); tree = draw(p);
    expect(content(tree)).toContain('diary.emptyMeal');
    press(named(tree, 'Pressable').find((n) => n.props.accessibilityLabel === 'diary.addFood')!);
    expect(p.onAddFood).toHaveBeenCalledWith('lunch');
  });

  it('shows calories from persisted totals and food snapshots, once per food', () => {
    const tree = draw(fixture());
    expect(content(row(tree, 'breakfast'))).toContain('233');
    expect(content(row(tree, 'lunch'))).toContain('—');
    expect(content(tree).match(/15\s+units.kcal/g)).toHaveLength(1);
    expect(content(tree).match(/95\s+units.kcal/g)).toHaveLength(1);
  });

  it('retains expansion through diary updates and a round trip between dates', () => {
    const p = fixture(); let tree = draw(p);
    press(row(tree, 'breakfast')); tree = draw(p);
    press(row(tree, 'lunch')); tree = draw(p);
    p.day = { ...p.day!, totals: { ...totals, kcal: 250 } };
    tree = draw(p);
    expect(row(tree, 'breakfast').props.accessibilityState).toEqual({ expanded: false });
    expect(row(tree, 'lunch').props.accessibilityState).toEqual({ expanded: true });
    draw({ ...p, localDate: '2026-10-15', day: null });
    tree = draw(p);
    expect(row(tree, 'lunch').props.accessibilityState).toEqual({ expanded: true });
  });

  it('hides stale records until the selected date has loaded', () => {
    const tree = draw({ ...fixture(), dayLoaded: false });
    expect(named(tree, 'SkeletonBlock')).toHaveLength(3);
    expect(content(tree)).not.toContain('Food tomato');
    expect(named(tree, 'DiaryNutritionSummary')).toHaveLength(0);
  });

  it('keeps header/date navigation outside the scroller and blocks future navigation', () => {
    const p = fixture(); let tree = draw(p);
    const scroller = named(tree, 'ScrollView')[0];
    expect(named(scroller, 'NuSheetHeader')).toHaveLength(0);
    expect(named(scroller, 'DateNav')).toHaveLength(0);
    const nav = localComponent(named(tree, 'DateNav')[0]);
    expect(named(nav, 'NuNav')[0].props.nextDisabled).toBe(true);
    (named(tree, 'NuSheetHeader')[0].props.onBack as () => void)();
    expect(p.onClose).toHaveBeenCalledOnce();
    tree = draw({ ...p, localDate: '2026-10-15' });
    const pastNav = named(localComponent(named(tree, 'DateNav')[0]), 'NuNav')[0];
    expect(pastNav.props.nextDisabled).toBe(false);
    (pastNav.props.onPrev as () => void)(); (pastNav.props.onNext as () => void)();
    expect(p.onPrevDay).toHaveBeenCalledOnce(); expect(p.onNextDay).toHaveBeenCalledOnce();
    expect(content(row(tree, 'morning_snack'))).not.toContain('home.mealsToday.nextMeal');
  });

  it('hosts search inside its one native Modal and sends Android back to the active overlay', () => {
    const p = { ...fixture(), overlay: React.createElement('SearchSheet'), onDismissOverlay: vi.fn() };
    const tree = draw(p);
    const modal = named(tree, 'Modal')[0];
    expect(named(modal, 'SearchSheet')).toHaveLength(1);
    (modal.props.onRequestClose as () => void)();
    expect(p.onDismissOverlay).toHaveBeenCalledOnce();
    expect(p.onClose).not.toHaveBeenCalled();
  });

  it('opens editing with the selected grams, delegates saving, and reinitializes for a different item', async () => {
    const p = fixture(); let tree = draw(p);
    options(tree); tree = draw(p); action(tree, 'diary.editGrams'); tree = draw(p);
    let sheet = named(tree, 'EditGramsSheet')[0];
    expect(sheet.props.initialGrams).toBe(100);
    await (sheet.props.onSave as (g: number) => Promise<void>)(110);
    expect(p.onEditGrams).toHaveBeenCalledWith('breakfast', p.day!.meals[0].items[0], 110);
    tree = draw(p); expect(named(tree, 'EditGramsSheet')).toHaveLength(0);
    options(tree, 'cheese'); tree = draw(p); action(tree, 'diary.editGrams'); tree = draw(p);
    sheet = named(tree, 'EditGramsSheet')[0]; expect(sheet.props.initialGrams).toBe(30);
  });

  it('shows only name, original quantity/unit and calories while preserving snapshot editing', async () => {
    const p = fixture(); const original = p.day!.meals[0].items[0];
    const entry = { id: 'snapshot-egg', source: 'plan_snapshot', quantity: 0.5, unit: 'unidade', preparationNote: 'Cozido',
      snapshot: { ...original.snapshot, name: 'Synthetic egg' }, loggedAt: original.loggedAt,
      base: { name: 'Synthetic egg', quantity: 0.5, unit: 'unidade', preparationNote: 'Cozido', nutrition: totals },
      planReference: { collection: 'nutritionPlans', documentId: 'p', optionId: 'breakfast-1', slot: 'breakfast', itemIndex: 0 },
    } as typeof original;
    p.day!.meals[0].items = [entry];
    let tree = draw(p);
    expect(content(tree)).toContain('Synthetic egg');
    expect(content(tree).replace(/\s+/g, ' ')).toContain('0.5 unidade');
    expect(content(tree).replace(/\s+/g, ' ')).toContain(`${entry.snapshot.kcal} units.kcal`);
    expect(content(tree)).not.toContain('diary.planEstimate');
    expect(content(tree)).not.toContain('Cozido');
    expect(content(tree)).not.toContain('undefined');
    options(tree, 'Synthetic egg'); tree = draw(p); action(tree, 'diary.editQuantity'); tree = draw(p);
    const sheet = named(tree, 'EditGramsSheet')[0]; expect(sheet.props.initialGrams).toBe(0.5); expect(sheet.props.unit).toBe('unidade');
    await (sheet.props.onSave as (q: number) => Promise<void>)(1.5);
    expect(p.onEditGrams).toHaveBeenCalledWith('breakfast', entry, 1.5);
  });

  it('preserves moving to another enabled meal', () => {
    const p = fixture(); let tree = draw(p);
    options(tree); tree = draw(p); action(tree, 'diary.moveMeal'); tree = draw(p);
    expect(named(tree, 'NuSelectPill').some((n) => n.key === 'breakfast')).toBe(false);
    press(named(tree, 'NuSelectPill').find((n) => n.key === 'lunch')!); tree = draw(p);
    press(named(tree, 'NuButton')[0]);
    expect(p.onMove).toHaveBeenCalledWith('breakfast', 'tomato', 'lunch');
  });

  it('requires the existing destructive confirmation before removing', () => {
    const p = fixture(); let tree = draw(p);
    options(tree); tree = draw(p); action(tree, 'diary.remove');
    expect(p.onRemove).not.toHaveBeenCalled();
    const buttons = runtime.alert.mock.calls[0][2] as { style: string; onPress?: () => void }[];
    expect(buttons.some((b) => b.style === 'cancel')).toBe(true);
    buttons.find((b) => b.style === 'destructive')!.onPress!();
    expect(p.onRemove).toHaveBeenCalledWith('breakfast', 'tomato');
  });

  it('dismisses stale action/edit sheets when the selected date changes', () => {
    const p = fixture(); let tree = draw(p);
    options(tree); tree = draw(p); action(tree, 'diary.editGrams'); tree = draw(p);
    expect(named(tree, 'EditGramsSheet')).toHaveLength(1);
    tree = draw({ ...p, localDate: '2026-10-15' });
    expect(named(tree, 'EditGramsSheet')).toHaveLength(0);
  });

  it('presents all real macro values and clamps bars for over-goal and zero targets', () => {
    const p = fixture(); const tree = draw(p);
    let summary = localComponent(named(tree, 'DiaryNutritionSummary')[0]);
    expect(content(summary)).toContain('3948');
    expect(content(summary)).toContain('3715');
    const bars = named(summary, 'DiaryProgress');
    expect(bars.map((b) => b.props.value)).toEqual([233, 12, 30, 8, 2]);
    expect(bars.map((b) => b.props.goal)).toEqual([3948, 205, 535, 110, 55]);
    const summaryNode = named(tree, 'DiaryNutritionSummary')[0];
    summary = localComponent({ ...summaryNode, props: { ...summaryNode.props, totals: { ...totals, kcal: 4000 } } });
    expect(content(summary)).toContain('diary.overGoal');
    expect(content(summary)).toContain('52');
    const overBar = localComponent(named(summary, 'DiaryProgress')[0]);
    expect(overBar.props.accessibilityValue).toEqual({ min: 0, max: 100, now: 100 });
    const zero = localComponent({ ...bars[0], props: { ...bars[0].props, goal: 0 } });
    expect(zero.props.accessibilityValue).toEqual({ min: 0, max: 100, now: 0 });
    const negative = localComponent({ ...bars[0], props: { ...bars[0].props, value: -1 } });
    expect(negative.props.accessibilityValue).toEqual({ min: 0, max: 100, now: 0 });
  });

  it('wraps macros on compact screens or enlarged fonts rather than truncating names', () => {
    const tree = draw(fixture());
    const summaryNode = named(tree, 'DiaryNutritionSummary')[0];
    for (const [width, fontScale, minimum] of [[390, 1, 0], [320, 1, 100], [390, 1.5, 120]]) {
      runtime.width = width; runtime.fontScale = fontScale;
      const summary = localComponent(summaryNode);
      const columns = named(summary, 'View').filter((n) => (n.props.style as { flexBasis?: string })?.flexBasis === '25%');
      expect(columns).toHaveLength(4);
      expect(columns.map((n) => (n.props.style as { minWidth: number }).minWidth)).toEqual(Array(4).fill(minimum));
      expect(nodes(summary).some((n) => n.props.numberOfLines === 1)).toBe(false);
    }
  });
});
