import { describe, expect, it } from 'vitest';
import { nextViewModelAfterLoad } from '../loadReducer';
import type { EvolutionViewModel } from '../types';

const VALID_PROGRESSING = {
  kind: 'PROGRESSING' as const,
  summary: {
    earnedLevel: 'INTERMEDIATE' as const, activeLevel: 'INTERMEDIATE' as const, cycleNumber: 2,
    proximity: 'ON_TRACK' as const, activeDays: 10, sessionsCompleted: 6, adherenceQuality: 'GOOD' as const, isHistoryComplete: true,
  },
} satisfies EvolutionViewModel;

describe('nextViewModelAfterLoad — resilience state machine (docs: resilience hardening 2026-09)', () => {
  it('initial load failure (nothing resolved yet) → ERROR', () => {
    expect(nextViewModelAfterLoad({ kind: 'LOADING' }, { status: 'failure' })).toEqual({
      kind: 'ERROR', message: 'WORKOUT_EVOLUTION_LOAD_FAILED',
    });
  });

  it('valid state → refresh fails → the last valid view model is preserved, not replaced by ERROR', () => {
    expect(nextViewModelAfterLoad(VALID_PROGRESSING, { status: 'failure' })).toBe(VALID_PROGRESSING);
  });

  it('valid state → refresh succeeds → the new view model correctly replaces the previous one', () => {
    const next: EvolutionViewModel = { kind: 'UNAVAILABLE' };
    expect(nextViewModelAfterLoad(VALID_PROGRESSING, { status: 'success', viewModel: next })).toBe(next);
  });

  it('valid state → refresh fails → then refresh succeeds → the UI ends up on the new state, not stuck on the old one', () => {
    const afterFailure = nextViewModelAfterLoad(VALID_PROGRESSING, { status: 'failure' });
    expect(afterFailure).toBe(VALID_PROGRESSING);
    const fresh: EvolutionViewModel = { kind: 'PROGRESSING', summary: { ...VALID_PROGRESSING.summary, cycleNumber: 3 } };
    const afterSuccess = nextViewModelAfterLoad(afterFailure, { status: 'success', viewModel: fresh });
    expect(afterSuccess).toBe(fresh);
  });

  it('a legitimate UNAVAILABLE (successfully determined "no lifecycle") is preserved across a subsequent transient failure', () => {
    const unavailable: EvolutionViewModel = { kind: 'UNAVAILABLE' };
    expect(nextViewModelAfterLoad(unavailable, { status: 'failure' })).toBe(unavailable);
  });

  it('a successful read legitimately landing on UNAVAILABLE is never overridden by "preserve previous" logic', () => {
    const next: EvolutionViewModel = { kind: 'UNAVAILABLE' };
    expect(nextViewModelAfterLoad(VALID_PROGRESSING, { status: 'success', viewModel: next })).toEqual({ kind: 'UNAVAILABLE' });
  });

  it('piling a second failure on top of an already-failed attempt stays ERROR (does not invent a cycle)', () => {
    const errorState: EvolutionViewModel = { kind: 'ERROR', message: 'WORKOUT_EVOLUTION_LOAD_FAILED' };
    expect(nextViewModelAfterLoad(errorState, { status: 'failure' })).toEqual({
      kind: 'ERROR', message: 'WORKOUT_EVOLUTION_LOAD_FAILED',
    });
  });

  it.each<EvolutionViewModel>([
    { kind: 'EVOLUTION_READY', summary: VALID_PROGRESSING.summary, pending: {
      type: 'CYCLE_EVOLUTION', quality: 'GOOD', fromLevel: 'INTERMEDIATE', toLevel: 'INTERMEDIATE',
      deferralCount: 0, nextPromptAt: null, autoActivateAt: null, sessionsCompletedAtEarn: 20,
    }, canDefer: true },
    { kind: 'EVOLUTION_DEFERRED', summary: VALID_PROGRESSING.summary, pending: {
      type: 'CYCLE_EVOLUTION', quality: 'GOOD', fromLevel: 'INTERMEDIATE', toLevel: 'INTERMEDIATE',
      deferralCount: 1, nextPromptAt: null, autoActivateAt: null, sessionsCompletedAtEarn: 20,
    } },
    { kind: 'AUTO_ACTIVATION_NOTICE', summary: VALID_PROGRESSING.summary, activatedType: 'CYCLE_EVOLUTION', activationEventId: 'evt-1' },
  ])('preserves $kind across a refresh failure the same way as PROGRESSING', (resolved) => {
    expect(nextViewModelAfterLoad(resolved, { status: 'failure' })).toBe(resolved);
  });
});
