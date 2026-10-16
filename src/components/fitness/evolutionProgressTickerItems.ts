import { weightFromKg, weightUnit } from '../../units/weightConversions';
import type { ResolvedUnits } from '../../types/units';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** `label` is the faint half, `value` is the accent/bold half — same split every existing ticker (Treino/Home/Dieta) uses. */
export interface EvolutionProgressTickerItem {
  label: string;
  value: string;
}

/**
 * Evolução's own ticker content — purely derived from data `ProgressScreen`
 * already loads (assessments, imported weights, load progress). Each item
 * is independently omitted when its backing real data doesn't exist yet;
 * never a fabricated placeholder. A real `0` (e.g. no PR in the last 90
 * days despite having load history) is shown as `0`, not omitted — that's
 * a true fact, not an absence of data.
 */
export function buildEvolutionProgressTickerItems({
  weightDeltaKg,
  lastAssessmentMeasuredAt,
  recordsLast90DaysCount,
  assessmentsCount,
  resolvedUnits,
  t,
}: {
  /** From `evolutionSincePrevious.weightDelta` — null when there's no previous assessment to compare against. */
  weightDeltaKg: number | null;
  /** From `latest.measuredAt.toDate()` — null when there's no assessment at all. */
  lastAssessmentMeasuredAt: Date | null;
  /** From `recordsLast90Days.length` — null when the account has no load history at all (never shown as a fabricated `0`). */
  recordsLast90DaysCount: number | null;
  /** From `assessments.length` — null when zero. */
  assessmentsCount: number | null;
  resolvedUnits: ResolvedUnits;
  t: (key: string, options?: Record<string, unknown>) => string;
}): EvolutionProgressTickerItem[] {
  const items: EvolutionProgressTickerItem[] = [];

  if (weightDeltaKg != null) {
    const unit = weightUnit(resolvedUnits);
    const magnitude = Math.abs(weightFromKg(weightDeltaKg, resolvedUnits)).toFixed(1);
    items.push({
      label: t('progress.ticker.weightSince'),
      value: `${weightDeltaKg >= 0 ? '+' : '−'}${magnitude} ${unit}`,
    });
  }

  if (lastAssessmentMeasuredAt) {
    const days = Math.max(0, Math.floor((Date.now() - lastAssessmentMeasuredAt.getTime()) / MS_PER_DAY));
    const value = days === 0
      ? t('progress.loads.ago.today')
      : days < 7
        ? t('progress.loads.ago.days', { count: days })
        : days < 28
          ? t('progress.loads.ago.weeks', { count: Math.floor(days / 7) })
          : t('progress.loads.ago.months', { count: Math.floor(days / 30) });
    items.push({ label: t('progress.ticker.lastAssessment'), value });
  }

  if (recordsLast90DaysCount != null) {
    items.push({ label: t('progress.ticker.records90d'), value: String(recordsLast90DaysCount) });
  }

  if (assessmentsCount != null) {
    items.push({ label: t('progress.ticker.assessmentsLogged'), value: String(assessmentsCount) });
  }

  return items;
}
