import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import copy from '../../../i18n/resources/pt-BR/nutrition.json';
import type { NutritionWeeklySummary, NutritionWeeklyWeightSummary } from '../../../nutrition/weekly';
import { NutritionWeeklySummaryScreen } from '../NutritionWeeklySummaryScreen';

const runtime = vi.hoisted(() => ({ width: 324, fontScale: 1, units: 'metric' as 'metric' | 'imperial', alert: vi.fn() }));
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useMemo: <T,>(compute: () => T) => compute(),
  useState: () => [runtime.width, (width: number) => { runtime.width = width; }],
}));
vi.mock('react-native', () => ({
  Alert: { alert: runtime.alert }, Pressable: 'Pressable', ScrollView: 'ScrollView', Text: 'Text', View: 'View',
  useWindowDimensions: () => ({ fontScale: runtime.fontScale }),
}));
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView' }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({
  t: (key: string, values?: Record<string, unknown>) => {
    const path = key.split('.');
    let value: unknown = copy;
    for (const part of path) value = (value as Record<string, unknown>)?.[part];
    if (value == null && values?.count != null) {
      value = (copy.weekly as Record<string, unknown>)[path[1] + (values.count === 1 ? '_one' : '_other')];
    }
    return typeof value === 'string' ? value.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values?.[name] ?? '')) : value ?? key;
  }, i18n: { language: 'pt-BR' },
}) }));
vi.mock('../../../components/nutrition/NutritionStates', () => ({ NutritionErrorState: 'NutritionErrorState' }));
vi.mock('../../../components/nutrition/NutritionPrimitives', () => ({ SkeletonBlock: 'SkeletonBlock' }));
vi.mock('../../../components/fitness/EvolutionAreaChart', () => ({ EvolutionAreaChart: 'EvolutionAreaChart' }));
vi.mock('../../../components/nutrition/NuKit', () => ({
  NU: { bg: 'bg', blueHi: 'blue', white: 'white', secondary: 'secondary' },
  NuButton: 'NuButton', NuCap: 'NuCap', NuNav: 'NuNav', NuSheetHeader: 'NuSheetHeader',
}));
vi.mock('../../../state/UnitsContext', () => ({ useUnits: () => ({ resolvedUnits: runtime.units }) }));

type Node = React.ReactElement<Record<string, unknown>>;
type Props = React.ComponentProps<typeof NutritionWeeklySummaryScreen>;
// Expand local presentation components, leaving native primitives as nodes.
function nodes(tree: unknown): Node[] {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!React.isValidElement<Record<string, unknown>>(tree)) return [];
  if (typeof tree.type === 'function') return [tree, ...nodes((tree.type as (props: Record<string, unknown>) => unknown)(tree.props))];
  return [tree, ...nodes(tree.props.children)];
}
function named(tree: unknown, name: string) {
  return nodes(tree).filter((node) => node.type === name || typeof node.type === 'function' && node.type.name === name);
}
function text(tree: unknown): string {
  if (Array.isArray(tree)) return tree.map(text).join(' ');
  if (React.isValidElement<Record<string, unknown>>(tree)) {
    if (typeof tree.type === 'function') return text((tree.type as (props: Record<string, unknown>) => unknown)(tree.props));
    return text(tree.props.children);
  }
  return tree == null ? '' : String(tree);
}
function summary(): NutritionWeeklySummary {
  const goal = { kcal: 3948, proteinG: 205, carbsG: 535, fatG: 110, fiberG: 55 };
  return {
    weekStartLocalDate: '2026-10-12', weekEndLocalDate: '2026-10-18', recordedDays: 1, totalMeals: 1, followedRecommendedMeals: 0,
    averageConsumed: { kcal: 561, proteinG: 50, carbsG: 56, fatG: 15, fiberG: 2 },
    averageFiberG: 2, fiberRecordedDays: 1, averageTarget: goal, targetDays: 7, planIds: ['plan-a'],
    days: Array.from({ length: 7 }, (_, index) => ({
      localDate: `2026-10-${12 + index}`, hasLog: index === 4,
      totals: index === 4 ? { kcal: 561, proteinG: 50, carbsG: 56, fatG: 15, fiberG: 2 } : null,
      fiberG: index === 4 ? 2 : null, mealCount: index === 4 ? 1 : 0, followedRecommendedCount: 0,
      target: goal, targetPlanId: 'plan-a',
    })),
  };
}
function props(): Props {
  return {
    summary: summary(), weight: null, loading: false, weightLoading: false, error: false, canGoNext: false,
    onBack: vi.fn(), onPreviousWeek: vi.fn(), onNextWeek: vi.fn(), onRetry: vi.fn(), onOpenProgress: vi.fn(),
  };
}
const render = (p = props()) => NutritionWeeklySummaryScreen(p);
const styles = (node: Node) => node.props.style as Record<string, unknown> | undefined;

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-16T12:00:00-03:00')); runtime.width = 324; runtime.fontScale = 1; runtime.units = 'metric'; runtime.alert.mockClear(); });
afterEach(() => vi.useRealTimers());

describe('Resumo Semanal dashboard', () => {
  it('renders four compact cards in the requested order, without rings or invented macro actions', () => {
    const tree = render();
    expect(named(tree, 'SectionBlock').map((n) => n.props.title)).toEqual(['Média diária', 'Consumo diário', 'Macronutrientes (média diária)', 'Peso']);
    expect(named(tree, 'NuRing')).toHaveLength(0);
    const macros = named(tree, 'MacrosSection')[0];
    expect(named(macros, 'ComparisonRow')).toHaveLength(4);
    expect(named(macros, 'Pressable')).toHaveLength(0);
    expect(named(macros, 'NuButton')).toHaveLength(0);
  });

  it('displays one week range and preserves close, week navigation and next-disabled state', () => {
    const p = props(), tree = render(p), nav = named(tree, 'NuNav')[0];
    expect(nav.props.label).toContain('12 de out.'); expect(nav.props.label).toContain('18 de out.');
    expect(nav.props.sub).toBeUndefined(); expect(nav.props.nextDisabled).toBe(true);
    (named(tree, 'NuSheetHeader')[0].props.onBack as () => void)();
    (nav.props.onPrev as () => void)();
    expect(p.onBack).toHaveBeenCalledOnce(); expect(p.onPreviousWeek).toHaveBeenCalledOnce();
    const past = named(render({ ...p, canGoNext: true }), 'NuNav')[0];
    expect(past.props.nextDisabled).toBe(false); (past.props.onNext as () => void)(); expect(p.onNextWeek).toHaveBeenCalledOnce();
  });

  it('uses the domain daily average rather than dividing partial weeks by seven', () => {
    const p = props(), section = named(render(p), 'CaloriesSection')[0];
    expect(text(section)).toContain('561'); expect(text(section)).toContain('14%');
    expect(text(section)).not.toContain('Média baseada em');
    (named(section, 'Pressable')[0].props.onPress as () => void)();
    expect(runtime.alert).toHaveBeenLastCalledWith('Média diária', 'Média baseada em 1 de 7 dias com registros.');
    expect(named(section, 'WeeklyBar')[0].props).toMatchObject({ value: 561, target: 3948 });
    p.summary = { ...p.summary!, recordedDays: 7, averageConsumed: { ...p.summary!.averageConsumed!, kcal: 1300 } };
    (named(named(render(p), 'CaloriesSection')[0], 'Pressable')[0].props.onPress as () => void)();
    expect(runtime.alert).toHaveBeenLastCalledWith('Média diária', 'Média baseada em 7 de 7 dias com registros.');
    expect(named(render(p), 'WeeklyBar')[0].props.value).toBe(1300);
  });

  it('keeps an empty week and missing nutrient values absent instead of inventing zero intake', () => {
    const s = summary(); s.recordedDays = 0; s.averageConsumed = null; s.averageFiberG = null;
    s.days = s.days.map((day) => ({ ...day, hasLog: false, totals: null }));
    const tree = render({ ...props(), summary: s });
    expect(text(named(tree, 'CaloriesSection')[0])).toContain(copy.weekly.empty);
    expect(named(tree, 'WeeklyBar').every((n) => n.props.value === null)).toBe(true);
    expect(named(tree, 'ComparisonRow').every((n) => !text(n).includes('0%'))).toBe(true);
  });

  it('does not invent percentages for absent or zero targets, and caps only the drawn bar above goal', () => {
    const s = summary(); s.averageTarget = null; s.targetDays = 0;
    s.days = s.days.map((d) => ({ ...d, target: null, targetPlanId: null }));
    let tree = render({ ...props(), summary: s });
    expect(text(tree)).toContain(copy.weekly.targetUnavailable);
    expect(named(tree, 'View').some((n) => n.props.accessibilityRole === 'progressbar')).toBe(false);
    s.averageTarget = { ...summary().averageTarget!, kcal: 0 };
    expect(text(named(render({ ...props(), summary: s }), 'CaloriesSection')[0])).not.toContain('%');
    s.averageTarget.kcal = 100;
    tree = render({ ...props(), summary: s });
    expect(text(named(tree, 'CaloriesSection')[0])).toContain('561%');
    const progress = named(tree, 'View').find((n) => n.props.accessibilityLabel === 'Calorias' && n.props.accessibilityRole === 'progressbar')!;
    expect(progress.props.accessibilityValue).toEqual({ min: 0, max: 100, now: 100 });
  });

  it('renders seven days with real values, distinguishes future days and draws only valid goal references', () => {
    const chart = named(render(), 'DaysSection')[0];
    const columns = named(chart, 'View').filter((n) => n.props.accessible);
    expect(columns).toHaveLength(7);
    expect(columns[4].props.accessibilityLabel).toContain('561 kcal');
    expect(columns[0].props.accessibilityLabel).toContain('Sem registro');
    expect(columns[6].props.accessibilityLabel).toContain('Dia futuro');
    expect(styles(columns[6])?.opacity).toBe(0.4);
    const lines = named(chart, 'View').filter((n) => styles(n)?.borderStyle === 'dashed');
    expect(lines).toHaveLength(1);
    expect(text(chart)).not.toContain(copy.weekly.noDataLegend);
    expect(text(chart)).not.toContain(copy.weekly.individualTargets);
    expect(columns[4].props.accessibilityLabel).toContain('Meta: 3948 kcal');
  });

  it('keeps explicit zero logs visible as zero and excludes missing-log totals from bars', () => {
    const s = summary(); s.days[0] = { ...s.days[0], hasLog: true, totals: { ...s.averageConsumed!, kcal: 0 } };
    s.days[1] = { ...s.days[1], totals: { ...s.averageConsumed!, kcal: 999 } };
    const chart = named(render({ ...props(), summary: s }), 'DaysSection')[0];
    const columns = named(chart, 'View').filter((n) => n.props.accessible);
    expect(columns[0].props.accessibilityLabel).toContain('0 kcal');
    expect(columns[1].props.accessibilityLabel).toContain('Sem registro');
    expect(columns[1].props.accessibilityLabel).not.toContain('999');
  });

  it('shows per-day targets for differing or missing goals instead of a misleading shared line', () => {
    const s = summary(); s.days[1] = { ...s.days[1], target: null }; s.targetDays = 6;
    s.days[2] = { ...s.days[2], target: { ...s.averageTarget!, kcal: 2000 } };
    const tree = render({ ...props(), summary: s }), chart = named(tree, 'DaysSection')[0];
    expect(text(chart)).not.toContain('Meta 2000'); expect(text(chart)).not.toContain('Meta 3948');
    const columns = named(chart, 'View').filter((n) => n.props.accessible);
    expect(columns[2].props.accessibilityLabel).toContain('Meta: 2000 kcal');
    const lines = named(chart, 'View').filter((n) => styles(n)?.borderStyle === 'dashed');
    expect(lines).toHaveLength(6);
    expect(text(named(tree, 'CaloriesSection')[0])).toContain('Meta média diária');
    expect(text(named(tree, 'MacrosSection')[0])).toContain('média dos 6 dias');
    expect(text(tree)).not.toContain('Meta planejada disponível para 6 de 7 dias.');
    const info = named(named(tree, 'CaloriesSection')[0], 'Pressable')[0];
    expect(info.props.accessibilityLabel).toBe('Sobre a média diária');
    (info.props.onPress as () => void)();
    expect(runtime.alert.mock.lastCall?.[1]).toContain('Meta planejada disponível para 6 de 7 dias.');
  });

  it('uses known-fiber coverage rather than the potentially incomplete daily fiber total', () => {
    const s = summary(); s.averageConsumed!.fiberG = 99; s.averageFiberG = null;
    let tree = render({ ...props(), summary: s });
    expect(named(tree, 'ComparisonRow')[3].props.value).toBeNull();
    s.averageFiberG = 2; s.fiberRecordedDays = 1; s.recordedDays = 3;
    tree = render({ ...props(), summary: s });
    expect(named(tree, 'ComparisonRow')[3].props.value).toBe(2);
    expect(text(tree)).toContain('Fibra calculada nos 1 dias');
  });

  it('preserves weight navigation, real measurements, unit conversion and the interactive chart', () => {
    const p = props(); let tree = render(p);
    expect(text(named(tree, 'WeightSection')[0])).toContain(copy.weekly.noWeeklyWeight);
    (named(tree, 'NuButton')[0].props.onPress as () => void)(); expect(p.onOpenProgress).toHaveBeenCalledOnce();
    const point = (id: string, weightKg: number) => ({ id, weightKg, measuredAt: new Date('2026-10-15T12:00:00Z'), localDate: '2026-10-15' });
    const weight: NutritionWeeklyWeightSummary = { latest: point('c', 78.4), previous: point('b', 79.1), deltaKg: -0.7, targetWeightKg: 75,
      points: [point('a', 80), point('b', 79.1), point('c', 78.4)], trendDeltaKg: -1.6, trendDirection: 'down' };
    runtime.units = 'imperial'; tree = render({ ...p, weight });
    expect(text(named(tree, 'WeightSection')[0])).toContain('172.8 lb');
    const points = named(tree, 'EvolutionAreaChart')[0].props.points as { value: number }[];
    expect(points[2].value).toBeCloseTo(172.8424, 3);
    expect(text(tree)).toContain('Tendência observada nas últimas 3 medições');
  });

  it('preserves loading/retry states and reserves bottom safe area only in the TabBar', () => {
    const p = props(); let tree = render({ ...p, loading: true });
    expect(named(tree, 'SkeletonBlock')).toHaveLength(4); expect(named(tree, 'CaloriesSection')).toHaveLength(0);
    tree = render({ ...p, weightLoading: true }); expect(named(tree, 'SkeletonBlock')).toHaveLength(1);
    tree = render({ ...p, error: true });
    (named(tree, 'NutritionErrorState')[0].props.onRetry as () => void)(); expect(p.onRetry).toHaveBeenCalledOnce();
    expect(named(tree, 'ScrollView')).toHaveLength(0);
    expect(named(tree, 'SafeAreaView')[0].props.edges).toEqual(['top']);
  });

  it('keeps the seven-column graph scrollable at narrow widths and enlarged system fonts', () => {
    runtime.width = 240; runtime.fontScale = 1.6;
    const chart = named(render(), 'DaysSection')[0], scroller = named(chart, 'ScrollView')[0];
    expect(scroller.props.horizontal).toBe(true);
    expect(named(chart, 'View').some((n) => styles(n)?.width === 448)).toBe(true);
    (scroller.props.onLayout as (e: unknown) => void)({ nativeEvent: { layout: { width: 520 } } });
    expect(named(named(render(), 'DaysSection')[0], 'View').some((n) => styles(n)?.width === 520)).toBe(true);
  });
});
