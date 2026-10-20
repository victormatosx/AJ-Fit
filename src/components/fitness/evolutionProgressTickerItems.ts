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
 *
 * An account with nothing logged at all used to produce zero items, which
 * left Evolução with a header and no info band. Once the screen's own loads
 * have settled (`dataSettled`), that case falls back to the two counts that
 * are genuinely known for an empty account — no records in the window, no
 * assessments — so the band is always there. Those zeros are real counts,
 * not placeholders; while the data is still loading or failed, the band
 * stays empty rather than claiming them.
 */
export function buildEvolutionProgressTickerItems({
  weightDeltaKg,
  lastAssessmentMeasuredAt,
  recordsLast90DaysCount,
  assessmentsCount,
  dataSettled,
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
  /** False while the screen's assessment/load reads are still in flight or failed — the empty band waits instead of claiming zeros. */
  dataSettled: boolean;
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

  if (items.length === 0 && dataSettled) {
    return [
      { label: t('progress.ticker.records90d'), value: '0' },
      { label: t('progress.ticker.assessmentsLogged'), value: '0' },
    ];
  }

  return items;
}
