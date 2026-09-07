import type { EvolutionViewModel } from './types';

/**
 * `label` is the discreet/faint half, `value` is the accent/bold half — the
 * historical Home ticker (commit d24319b) always rendered every item this
 * way (label in `colors.faint`, value in `colors.accentHi`/monoBold), never
 * conditionally. `label` is empty for a single free-standing status line
 * (e.g. "evaluation paused") that has no separate label half.
 */
export interface TickerItem {
  label: string;
  value: string;
}

/**
 * Presentation content for `EvolutionTicker`. Purely derived from an
 * already-built `EvolutionViewModel` — never recomputes eligibility, level,
 * cycle, adherence or proximity (docs §4/§B, mirrors `EvolutionCard`).
 */
export type EvolutionTickerContent =
  | { mode: 'HIDDEN' }
  | { mode: 'STATIC'; text: string }
  | { mode: 'MARQUEE'; items: TickerItem[] }
  | {
      mode: 'ACTION';
      icon: 'sparkles' | 'trophy';
      headline: string;
      /** Set only when `earnedLevel !== activeLevel` — a promotion already earned but not yet reflected in the active prescription (docs §19-21/§100/§AE). Never dropped silently. */
      earnedLevelNote: string | null;
      ctaLabel: string;
      accessibilityLabel: string;
    };

export interface TickerTranslate {
  (key: string, options?: Record<string, unknown>): string;
}

/** The cycle number is deliberately never surfaced here — real but low
 * emotional signal for a compact Home marquee (see audit §11/§H). It
 * remains available on the Profile card and the unlock screen. */
export function buildEvolutionTickerContent(
  viewModel: EvolutionViewModel,
  t: TickerTranslate,
): EvolutionTickerContent {
  if (viewModel.kind === 'LOADING') return { mode: 'STATIC', text: t('state.loading') };
  if (viewModel.kind === 'ERROR') return { mode: 'STATIC', text: t('state.error') };
  if (viewModel.kind === 'UNAVAILABLE') return { mode: 'HIDDEN' };

  const { summary } = viewModel;
  const earnedLevelNote = summary.earnedLevel !== summary.activeLevel
    ? t('careerLevel', { level: t(`level.${summary.earnedLevel}`) })
    : null;

  if (viewModel.kind === 'AUTO_ACTIVATION_NOTICE') {
    return {
      mode: 'ACTION',
      icon: 'sparkles',
      headline: t(`auto.card.${viewModel.activatedType}`),
      earnedLevelNote,
      ctaLabel: t('ticker.viewChanges'),
      accessibilityLabel: t('ticker.accessibility.openAutoActivation'),
    };
  }

  if (viewModel.kind === 'EVOLUTION_READY' || viewModel.kind === 'EVOLUTION_DEFERRED') {
    const isRenewal = viewModel.pending.type === 'MOTIVATIONAL_RENEWAL';
    const headline = isRenewal
      ? t('motivationalRenewal.cardReady')
      : viewModel.pending.type === 'LEVEL_PROMOTION'
        ? t('unlock.levelReadyCard')
        : t('unlock.cycleReadyCard');
    return {
      mode: 'ACTION',
      icon: isRenewal ? 'sparkles' : 'trophy',
      headline,
      earnedLevelNote,
      ctaLabel: t('ticker.viewEvolution'),
      accessibilityLabel: t('ticker.accessibility.openEvolution'),
    };
  }

  // PROGRESSING — every item keeps the historical label (faint) / value
  // (accent) split, each field mapped from a single real summary field.
  const items: TickerItem[] = [
    { label: t('activePrescription'), value: t(`level.${summary.activeLevel}`) },
  ];
  if (earnedLevelNote) {
    items.push({ label: t('ticker.labels.earnedLevel'), value: t(`level.${summary.earnedLevel}`) });
  }
  if (summary.activeDays !== null) {
    items.push({ label: t('ticker.labels.activeDays'), value: String(summary.activeDays) });
  }
  if (summary.sessionsCompleted !== null) {
    items.push({ label: t('ticker.labels.sessions'), value: String(summary.sessionsCompleted) });
  }
  if (summary.adherenceQuality) {
    items.push({ label: t('ticker.labels.adherence'), value: t(`ticker.values.adherence.${summary.adherenceQuality}`) });
  }
  items.push(
    summary.proximity
      ? { label: t('ticker.labels.proximity'), value: t(`ticker.values.proximity.${summary.proximity}`) }
      : { label: '', value: t('state.evaluationPaused') },
  );

  return { mode: 'MARQUEE', items };
}
