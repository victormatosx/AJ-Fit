import { requiredActiveDaysForLevel } from '../home/evoRingMetrics';
import type { EvolutionSummaryPresentationCache } from '../lib/evolutionSummaryPresentationCache';
import type { EvolutionViewModel } from './types';

/** Turns the deliberately-smaller disk schema into the existing safe visual path. */
export function viewModelFromEvolutionPresentationCache(
  cache: EvolutionSummaryPresentationCache,
): Extract<EvolutionViewModel, { kind: 'SUMMARY_READY' }> {
  return {
    kind: 'SUMMARY_READY',
    source: 'CACHE',
    summary: {
      // Earned level is intentionally not persisted. Null suppresses any
      // earned/promotion claim until the current authoritative read arrives.
      earnedLevel: null,
      activeLevel: cache.summary.activeLevel,
      cycleNumber: cache.summary.cycleNumber,
      proximity: cache.summary.proximity,
      activeDays: cache.summary.activeDays,
      sessionsCompleted: cache.summary.sessionsCompleted,
      adherenceQuality: cache.summary.adherenceQuality,
      // Also deliberately absent from disk; Home does not render this flag.
      isHistoryComplete: false,
      // Deliberately defaulted to null, same reasoning as earnedLevel/isHistoryComplete above —
      // a stale cached entry never claims a numeric adherence ratio, a pause, or a cycle count.
      adherenceRatio: null,
      // NOT defaulted: freshly derived from the cached activeLevel (a pure function of a
      // value the cache already stores), so it's always correct — never "fix" this to null.
      requiredActiveDays: requiredActiveDaysForLevel(cache.summary.activeLevel),
      pausedAtLocalDate: null,
      intermediateCyclesEarned: null,
    },
  };
}

/**
 * Any previously-actionable view becomes summary-only while a refresh is in
 * flight. This preserves the occupied layout but makes stale post-workout or
 * foreground actions impossible until the new authoritative terminal state.
 */
export function viewModelWhileEvolutionRefreshes(current: EvolutionViewModel): EvolutionViewModel {
  if (current.kind === 'PROGRESSING' || current.kind === 'EVOLUTION_READY' ||
      current.kind === 'EVOLUTION_DEFERRED' || current.kind === 'AUTO_ACTIVATION_NOTICE') {
    return { kind: 'SUMMARY_READY', source: 'CURRENT_SESSION', summary: current.summary };
  }
  return current;
}

export function evolutionSummaryOf(viewModel: EvolutionViewModel) {
  return 'summary' in viewModel ? viewModel.summary : null;
}
