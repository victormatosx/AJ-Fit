import { requiredActiveDaysForLevel } from '../home/evoRingMetrics';
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

function buildProgressingSummary(
  decision: ProgressionDecision,
  lifecycle: LifecycleContext,
  extra: { pausedAtLocalDate: string | null; intermediateCyclesEarned: number | null },
): ProgressingSummary {
  const base = {
    earnedLevel: lifecycle.earnedLevel,
    activeLevel: lifecycle.activeLevel,
    cycleNumber: lifecycle.cycleNumber,
    isHistoryComplete: lifecycle.isHistoryComplete,
    requiredActiveDays: requiredActiveDaysForLevel(lifecycle.activeLevel),
    pausedAtLocalDate: extra.pausedAtLocalDate,
    intermediateCyclesEarned: extra.intermediateCyclesEarned,
  };
  if (decision.type === 'NO_ACTION') {
    return { ...base, proximity: null, activeDays: null, sessionsCompleted: null, adherenceQuality: null, adherenceRatio: null };
  }
  return {
    ...base,
    proximity: proximityFromDecision(decision),
    activeDays: decision.activeDays,
    sessionsCompleted: decision.validSessionCount,
    adherenceQuality: decision.adherence.quality,
    adherenceRatio: decision.adherence.ratio,
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
  /** Will be sourced from a separate `evaluateProgressionV2ForUserFull` read once `useWorkoutEvolution.ts` is wired up (a later task) — until then, always `null`/omitted. Omitted/undefined is treated as `null` (not-yet-known), never as "not paused". */
  pausedAtLocalDate?: string | null;
  intermediateCyclesEarned?: number | null;
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

/** Shared by the terminal presenter and the provisional (Fase 5.2) one — the
 * exact same summary shape regardless of which wrapper kind ends up winning. */
function buildSummary(
  decision: ProgressionDecision | null,
  lifecycle: LifecycleContext,
  extra: { pausedAtLocalDate: string | null; intermediateCyclesEarned: number | null },
): ProgressingSummary {
  return decision
    ? buildProgressingSummary(decision, lifecycle, extra)
    : {
        earnedLevel: lifecycle.earnedLevel,
        activeLevel: lifecycle.activeLevel,
        cycleNumber: lifecycle.cycleNumber,
        isHistoryComplete: lifecycle.isHistoryComplete,
        requiredActiveDays: requiredActiveDaysForLevel(lifecycle.activeLevel),
        pausedAtLocalDate: extra.pausedAtLocalDate,
        intermediateCyclesEarned: extra.intermediateCyclesEarned,
        proximity: null,
        activeDays: null,
        sessionsCompleted: null,
        adherenceQuality: null,
        adherenceRatio: null,
      };
}

/**
 * Progressive rendering (Fase 5.2) — call once `lifecycle`+`pending`+`decision`
 * are known (post-reconcile) but before the pending/auto-activation-notice
 * check (which needs a further, lifecycle-dependent read) has resolved.
 * `summary` here is byte-identical to what `buildEvolutionViewModel` would
 * embed in the eventual terminal kind for the same inputs — see the shared
 * `buildSummary` above — so revealing it early can never require a later
 * correction. Never call this with data that hasn't itself already passed
 * through a real reconcile; it is not a cache and carries no memory of a
 * previous load.
 */
export function buildProvisionalEvolutionViewModel(input: {
  lifecycle: LifecycleContext;
  decision: ProgressionDecision | null;
  pausedAtLocalDate?: string | null;
  intermediateCyclesEarned?: number | null;
}): EvolutionViewModel {
  return {
    kind: 'SUMMARY_READY',
    source: 'CURRENT_SESSION',
    summary: buildSummary(input.decision, input.lifecycle, {
      pausedAtLocalDate: input.pausedAtLocalDate ?? null,
      intermediateCyclesEarned: input.intermediateCyclesEarned ?? null,
    }),
  };
}

export function buildEvolutionViewModel(input: EvolutionViewModelInput): EvolutionViewModel {
  if (input.error) return { kind: 'ERROR', message: input.error };
  if (!input.lifecycle) return { kind: 'LOADING' };

  const extra = {
    pausedAtLocalDate: input.pausedAtLocalDate ?? null,
    intermediateCyclesEarned: input.intermediateCyclesEarned ?? null,
  };
  const summary = buildSummary(input.decision, input.lifecycle, extra);

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
