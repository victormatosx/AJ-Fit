import type { EvolutionViewModel } from '../../workoutEvolution/types';
import type { DailyActivityStreak } from '../../home/dailyActivityStreak';

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

export interface HomeEvoTickerItem { label: string; value: string }

/**
 * Pure item-list builder for `HomeEvoTicker`'s marquee — mirrors
 * `workoutEvolution/tickerItems.ts`'s `buildEvolutionTickerContent` in shape
 * (a plain function taking the view model + a translate fn, independently
 * gating each item on its own real-data nullability) so this logic is
 * testable without mounting the component. Each of the 6 items is omitted,
 * never rendered as 0/fabricated, when its backing data is unavailable.
 *
 * Returns `{label, value}` pairs (not one combined string) so the component
 * can render the same two-tone label/value treatment as `EvolutionTicker`
 * (Treino) and the Nutrição redesign's own ticker — one consistent look
 * across every tab's scrolling info strip.
 */
export function buildHomeEvoTickerItems(
  viewModel: EvolutionViewModel,
  streak: DailyActivityStreak | null,
  sessionsLast30Days: number | null,
  t: HomeEvoTickerTranslate,
): HomeEvoTickerItem[] {
  if (viewModel.kind === 'LOADING' || viewModel.kind === 'ERROR' || viewModel.kind === 'UNAVAILABLE') return [];
  const { summary } = viewModel;
  const result: HomeEvoTickerItem[] = [];
  if (streak) {
    // The daily activity streak is always a count of DAYS (a workout or a
    // food entry on that calendar day), so unlike the obligations/weeks
    // streak it needs no per-unit value key.
    result.push({ label: t('home:evoTicker.streakLabel'), value: t('home:evoTicker.streakValue', { count: streak.current }) });
  }
  if (summary.activeDays !== null) {
    result.push({
      label: t('home:evoTicker.activeDaysLabel'),
      value: t('home:evoTicker.activeDaysValue', { count: summary.activeDays, required: summary.requiredActiveDays }),
    });
  }
  if (summary.adherenceRatio !== null) {
    result.push({ label: t('home:evoTicker.adherenceLabel'), value: t('home:evoTicker.adherenceValue', { percent: Math.round(summary.adherenceRatio * 100) }) });
  }
  result.push({ label: t('home:evoTicker.cycleLabel'), value: t('home:evoTicker.cycleValue', { number: summary.cycleNumber }) });
  result.push({ label: t('home:evoTicker.levelLabel'), value: t('home:evoTicker.levelValue', { level: t(`evolution:level.${summary.activeLevel}`) }) });
  if (sessionsLast30Days !== null) {
    result.push({ label: t('home:evoTicker.sessions30dLabel'), value: t('home:evoTicker.sessions30dValue', { count: sessionsLast30Days }) });
  }
  return result;
}
