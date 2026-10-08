import type { EvolutionViewModel } from '../../workoutEvolution/types';
import type { Streak } from '../../home/streak';

/**
 * Loose stand-in for react-i18next's strictly-keyed `t`, same role as
 * `workoutEvolution/tickerItems.ts`'s `TickerTranslate` — this ticker reads
 * two namespaces (`home:`/`evolution:` prefixed keys), which the real
 * `TFunction`'s generated key union can't express without pinning a single
 * namespace, so `buildHomeEvoTickerItems` takes this instead and the
 * component bridges the real `t` into it with a type assertion (mirrors
 * `EvolutionTicker.tsx`'s own `tLoose`). Kept in this RN-free sibling file
 * (not `HomeEvoTicker.tsx` itself) so it — and the function below — can be
 * unit tested without pulling in `react-native`/`react-i18next`.
 */
export interface HomeEvoTickerTranslate {
  (key: string, options?: Record<string, unknown>): string;
}

/**
 * Pure item-list builder for `HomeEvoTicker`'s marquee — mirrors
 * `workoutEvolution/tickerItems.ts`'s `buildEvolutionTickerContent` in shape
 * (a plain function taking the view model + a translate fn, independently
 * gating each item on its own real-data nullability) so this logic is
 * testable without mounting the component. Each of the 6 items is omitted,
 * never rendered as 0/fabricated, when its backing data is unavailable.
 */
export function buildHomeEvoTickerItems(
  viewModel: EvolutionViewModel,
  streak: Streak | null,
  sessionsLast30Days: number | null,
  t: HomeEvoTickerTranslate,
): string[] {
  if (viewModel.kind === 'LOADING' || viewModel.kind === 'ERROR' || viewModel.kind === 'UNAVAILABLE') return [];
  const { summary } = viewModel;
  const result: string[] = [];
  if (streak) {
    result.push(t('home:evoTicker.streak', { count: streak.current }));
  }
  if (summary.activeDays !== null) {
    result.push(t('home:evoTicker.activeDays', { count: summary.activeDays, required: summary.requiredActiveDays }));
  }
  if (summary.adherenceRatio !== null) {
    result.push(t('home:evoTicker.adherence', { percent: Math.round(summary.adherenceRatio * 100) }));
  }
  result.push(t('home:evoTicker.cycle', { number: summary.cycleNumber }));
  result.push(t('home:evoTicker.level', { level: t(`evolution:level.${summary.activeLevel}`) }));
  if (sessionsLast30Days !== null) {
    result.push(t('home:evoTicker.sessions30d', { count: sessionsLast30Days }));
  }
  return result;
}
