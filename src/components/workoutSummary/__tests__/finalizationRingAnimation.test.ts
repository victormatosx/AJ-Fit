import { describe, expect, it } from 'vitest';

import {
  decideFinalizationRingAction,
  INITIAL_FINALIZATION_RING_TRANSITION_STATE,
  type FinalizationRingPhase,
  type FinalizationRingTransitionState,
} from '../finalizationRingAnimation';

function apply(state: FinalizationRingTransitionState, phase: FinalizationRingPhase) {
  return decideFinalizationRingAction(state, phase);
}

describe('decideFinalizationRingAction', () => {
  it('mounting fresh in ramping resets and starts the ramp', () => {
    const { action, nextState } = apply(INITIAL_FINALIZATION_RING_TRANSITION_STATE, 'ramping');
    expect(action).toEqual({ type: 'RESET_AND_RAMP' });
    expect(nextState).toEqual({ previousPhase: 'ramping', hasReachedComplete: false });
  });

  it('a real ramping → completing transition animates to 100', () => {
    const ramping = apply(INITIAL_FINALIZATION_RING_TRANSITION_STATE, 'ramping').nextState;
    const { action, nextState } = apply(ramping, 'completing');
    expect(action).toEqual({ type: 'ANIMATE_TO_COMPLETE' });
    expect(nextState).toEqual({ previousPhase: 'completing', hasReachedComplete: true });
  });

  it('mounting already in "completing" (e.g. a remount after commit) snaps straight to 100, never replaying the ramp', () => {
    const { action, nextState } = apply(INITIAL_FINALIZATION_RING_TRANSITION_STATE, 'completing');
    expect(action).toEqual({ type: 'SNAP_TO_COMPLETE' });
    expect(nextState.hasReachedComplete).toBe(true);
  });

  it('once completing is reached, repeated "completing" phases are no-ops (no replayed animation)', () => {
    let state = apply(INITIAL_FINALIZATION_RING_TRANSITION_STATE, 'completing').nextState;
    for (let i = 0; i < 5; i += 1) {
      const result = apply(state, 'completing');
      expect(result.action).toEqual({ type: 'NONE' });
      expect(result.nextState.hasReachedComplete).toBe(true);
      state = result.nextState;
    }
  });

  it('CRITICAL: once completing is reached, a later "ramping" phase (stray re-render, remount, prop glitch) is ignored — the arc never moves back toward 0', () => {
    const completed = apply(INITIAL_FINALIZATION_RING_TRANSITION_STATE, 'completing').nextState;
    expect(completed.hasReachedComplete).toBe(true);

    const afterStrayRamping = apply(completed, 'ramping');
    expect(afterStrayRamping.action).toEqual({ type: 'NONE' });
    expect(afterStrayRamping.nextState.hasReachedComplete).toBe(true);

    // Even many repeated stray 'ramping' phases never unlatch it.
    let state = afterStrayRamping.nextState;
    for (let i = 0; i < 10; i += 1) {
      const result = apply(state, 'ramping');
      expect(result.action).toEqual({ type: 'NONE' });
      expect(result.nextState.hasReachedComplete).toBe(true);
      state = result.nextState;
    }
  });

  it('failed freezes the arc wherever it is', () => {
    const ramping = apply(INITIAL_FINALIZATION_RING_TRANSITION_STATE, 'ramping').nextState;
    const { action, nextState } = apply(ramping, 'failed');
    expect(action).toEqual({ type: 'FREEZE' });
    expect(nextState.hasReachedComplete).toBe(false);
  });

  it('failed is the only way to unlatch an already-completed attempt, enabling a legitimate retry to ramp from 0 again', () => {
    const completed = apply(INITIAL_FINALIZATION_RING_TRANSITION_STATE, 'completing').nextState;
    const failed = apply(completed, 'failed');
    expect(failed.action).toEqual({ type: 'FREEZE' });
    expect(failed.nextState.hasReachedComplete).toBe(false);

    const retryRamp = apply(failed.nextState, 'ramping');
    expect(retryRamp.action).toEqual({ type: 'RESET_AND_RAMP' });
  });

  it('mounting fresh in "failed" just freezes, no ramp is ever started', () => {
    const { action, nextState } = apply(INITIAL_FINALIZATION_RING_TRANSITION_STATE, 'failed');
    expect(action).toEqual({ type: 'FREEZE' });
    expect(nextState.hasReachedComplete).toBe(false);
  });

  it('repeating the same non-completing phase twice in a row is a no-op the second time', () => {
    const first = apply(INITIAL_FINALIZATION_RING_TRANSITION_STATE, 'ramping');
    const second = apply(first.nextState, 'ramping');
    expect(second.action).toEqual({ type: 'NONE' });
  });
});
