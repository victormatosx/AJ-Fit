import type { ProgressionDecision } from '../progressionEngineV2/types';
import { isPromptable, type DeferralView } from '../workoutLifecycle/deferral';
import type { CurrentTrainingLevel, PendingEvolutionType } from '../workoutLifecycle/types';
import type { EvolutionViewModel, PendingEvolutionSummary, ProgressingSummary, ProximityState } from './types';

/** Presentation only maps authoritative engine outcomes; it never measures a
 * made-up fraction of a multidimensional eligibility rule. */
export function proximityFromDecision(decision: ProgressionDecision): ProximityState | null {
  if (decision.type === 'NO_ACTION') return null;
  if (decision.type !== 'PROGRESS_CONTINUES') return 'READY';
  return decision.reason === 'MINIMUM_ACTIVE_TIME_NOT_REACHED' ? 'BUILDING' : 'ON_TRACK';
}

export interface LifecycleContext {
  earnedLevel: CurrentTrainingLevel;
  activeLevel: CurrentTrainingLevel;
  cycleNumber: number;
  /** False only for an un-augmented V1 baseline (docs §78/§79). */
  isHistoryComplete: boolean;
}

function buildProgressingSummary(decision: ProgressionDecision, lifecycle: LifecycleContext): ProgressingSummary {
  const base = {
    earnedLevel: lifecycle.earnedLevel,
    activeLevel: lifecycle.activeLevel,
    cycleNumber: lifecycle.cycleNumber,
    isHistoryComplete: lifecycle.isHistoryComplete,
  };
  if (decision.type === 'NO_ACTION') {
    return { ...base, proximity: null, activeDays: null, sessionsCompleted: null, adherenceQuality: null };
  }
  return {
    ...base,
    proximity: proximityFromDecision(decision),
    activeDays: decision.activeDays,
    sessionsCompleted: decision.validSessionCount,
    adherenceQuality: decision.adherence.quality,
  };
}

export interface EvolutionViewModelInput {
  now: Date;
  lifecycle: LifecycleContext | null;
  /** `null` while progression hasn't been evaluated yet (loading), never a fabricated PROGRESSING state (docs §76). */
  decision: ProgressionDecision | null;
  pending: PendingEvolutionSummary | null;
  /** Latest persisted AUTO activation for the currently-active ProgramInstance, after UX acknowledgement filtering. */
  autoActivationNotice: { eventId: string; type: PendingEvolutionType } | null;
  error?: string;
}

/**
 * True for any `EvolutionViewModel.kind` that reflects a completed,
 * successfully-resolved read — `LOADING` (nothing resolved yet) and `ERROR`
 * (the read itself failed) are the only two that are NOT one. `UNAVAILABLE`
 * counts as resolved too: it's a legitimate, successfully-determined outcome
 * ("no lifecycle exists yet"), not a failure. A transient refresh failure
 * must never discard a resolved view model in favor of `ERROR` — the caller
 * (`useWorkoutEvolution`) uses this to decide whether a failed `load()` may
 * overwrite the current state or must preserve it (docs: Workout Evolution
 * resilience hardening, 2026-09).
 */
export function isResolvedEvolutionViewModel(viewModel: EvolutionViewModel): boolean {
  return viewModel.kind !== 'LOADING' && viewModel.kind !== 'ERROR';
}

export function buildEvolutionViewModel(input: EvolutionViewModelInput): EvolutionViewModel {
  if (input.error) return { kind: 'ERROR', message: input.error };
  if (!input.lifecycle) return { kind: 'LOADING' };

  const summary = input.decision
    ? buildProgressingSummary(input.decision, input.lifecycle)
    : {
        earnedLevel: input.lifecycle.earnedLevel,
        activeLevel: input.lifecycle.activeLevel,
        cycleNumber: input.lifecycle.cycleNumber,
        isHistoryComplete: input.lifecycle.isHistoryComplete,
        proximity: null,
        activeDays: null,
        sessionsCompleted: null,
        adherenceQuality: null,
      };

  if (input.autoActivationNotice) {
    return {
      kind: 'AUTO_ACTIVATION_NOTICE',
      summary,
      activatedType: input.autoActivationNotice.type,
      activationEventId: input.autoActivationNotice.eventId,
    };
  }

  if (input.pending) {
    const view: DeferralView = {
      pendingEvolutionId: '', // not needed by isPromptable
      status: input.pending.deferralCount === 0 ? 'READY' : 'DEFERRED',
      deferralCount: input.pending.deferralCount,
      nextPromptAt: input.pending.nextPromptAt,
      autoActivateAt: input.pending.autoActivateAt,
    };
    if (isPromptable(view, input.now)) {
      return { kind: 'EVOLUTION_READY', summary, pending: input.pending, canDefer: input.pending.deferralCount < 2 };
    }
    return { kind: 'EVOLUTION_DEFERRED', summary, pending: input.pending };
  }

  if (!input.decision) return { kind: 'LOADING' };
  return { kind: 'PROGRESSING', summary };
}
