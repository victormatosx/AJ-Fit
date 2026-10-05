/**
 * Pure decision logic for `FinalizationProgressRing`'s shared-value
 * animation — zero React/Reanimated imports, so it's testable without any
 * rendering runtime. This is the single source of truth for the "100% →
 * 0%" regression: once an attempt has genuinely reached `'completing'`
 * (`hasReachedComplete` latches `true`), nothing can move the arc again
 * except a real `'failed'` phase (a genuinely new attempt). In particular,
 * a later `phase` prop value of `'ramping'` — whatever upstream cause
 * produced it (a stray re-render, a parent remount, a prop glitch) — is
 * ignored outright instead of being allowed to replay the ramp from 0.
 *
 * Mounting (or remounting) with `phase` already `'completing'` is handled
 * explicitly too (`SNAP_TO_COMPLETE`): there is nothing legitimate to
 * animate from in that case — the ramp already happened in a reality the
 * user already saw (or a remount erased) — so it snaps straight to 100
 * rather than replaying a 0→100 animation, which is exactly what used to
 * flash a visible "0%".
 */
export type FinalizationRingPhase = 'ramping' | 'completing' | 'failed';

export type FinalizationRingAction =
  | { type: 'RESET_AND_RAMP' }
  | { type: 'ANIMATE_TO_COMPLETE' }
  | { type: 'SNAP_TO_COMPLETE' }
  | { type: 'FREEZE' }
  | { type: 'NONE' };

export interface FinalizationRingTransitionState {
  previousPhase: FinalizationRingPhase | null;
  /** Sticky for the current attempt — see the module doc comment. */
  hasReachedComplete: boolean;
}

export const INITIAL_FINALIZATION_RING_TRANSITION_STATE: FinalizationRingTransitionState = {
  previousPhase: null,
  hasReachedComplete: false,
};

export function decideFinalizationRingAction(
  state: FinalizationRingTransitionState,
  phase: FinalizationRingPhase,
): { action: FinalizationRingAction; nextState: FinalizationRingTransitionState } {
  const { previousPhase, hasReachedComplete } = state;

  if (phase === 'completing') {
    const nextState: FinalizationRingTransitionState = { previousPhase: phase, hasReachedComplete: true };
    if (previousPhase === null) {
      return { action: { type: 'SNAP_TO_COMPLETE' }, nextState };
    }
    if (previousPhase === 'completing') {
      return { action: { type: 'NONE' }, nextState };
    }
    return { action: { type: 'ANIMATE_TO_COMPLETE' }, nextState };
  }

  if (hasReachedComplete) {
    if (phase === 'failed') {
      // The only legitimate way an attempt that already completed can end:
      // a brand new attempt (a future 'ramping') is free to start from 0.
      return { action: { type: 'FREEZE' }, nextState: { previousPhase: phase, hasReachedComplete: false } };
    }
    // Latched: ignore anything else, including a stray 'ramping' — it is
    // not a real new attempt, so the arc must not move.
    return { action: { type: 'NONE' }, nextState: { ...state, previousPhase: phase } };
  }

  if (phase === previousPhase) {
    return { action: { type: 'NONE' }, nextState: state };
  }

  const nextState: FinalizationRingTransitionState = { previousPhase: phase, hasReachedComplete: false };
  if (phase === 'ramping') {
    return { action: { type: 'RESET_AND_RAMP' }, nextState };
  }
  return { action: { type: 'FREEZE' }, nextState };
}
