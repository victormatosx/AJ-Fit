import { describe, expect, it } from 'vitest';
import type { ProgressionDecision } from '../../progressionEngineV2/types';
import { buildEvolutionViewModel, proximityFromDecision, type LifecycleContext } from '../viewModel';
import type { PendingEvolutionSummary } from '../types';

const NOW = new Date('2026-06-01T00:00:00.000Z');
const NO_NOTICE = { autoActivationNotice: null } as const;

function lifecycle(overrides: Partial<LifecycleContext> = {}): LifecycleContext {
  return { earnedLevel: 'BEGINNER', activeLevel: 'BEGINNER', cycleNumber: 1, isHistoryComplete: true, ...overrides };
}

function progressing(overrides: Partial<Extract<ProgressionDecision, { type: 'PROGRESS_CONTINUES' }>> = {}): ProgressionDecision {
  return { type: 'PROGRESS_CONTINUES', reason: 'MINIMUM_ACTIVE_TIME_NOT_REACHED', activeDays: 0,
    adherence: { ratio: 0, quality: 'BELOW_TARGET' }, validSessionCount: 0, ...overrides };
}

function pending(overrides: Partial<PendingEvolutionSummary> = {}): PendingEvolutionSummary {
  return { type: 'CYCLE_EVOLUTION', quality: 'GOOD', fromLevel: 'INTERMEDIATE', toLevel: 'INTERMEDIATE',
    deferralCount: 0, nextPromptAt: null, autoActivateAt: null, sessionsCompletedAtEarn: 20, ...overrides };
}

describe('truthful lifecycle boundary', () => {
  it('does not invent lifecycle while loading or on error', () => {
    expect(buildEvolutionViewModel({ now: NOW, lifecycle: null, decision: null, pending: null, ...NO_NOTICE })).toEqual({ kind: 'LOADING' });
    expect(buildEvolutionViewModel({ now: NOW, lifecycle: lifecycle(), decision: null, pending: null, error: 'boom', ...NO_NOTICE }))
      .toEqual({ kind: 'ERROR', message: 'boom' });
  });

  it('surfaces real dimensions and exposes no synthetic progress field', () => {
    const vm = buildEvolutionViewModel({ now: NOW, lifecycle: lifecycle(), pending: null, ...NO_NOTICE,
      decision: progressing({ activeDays: 12, validSessionCount: 8, adherence: { ratio: 0.64, quality: 'BELOW_TARGET' } }) });
    expect(vm.kind).toBe('PROGRESSING');
    if (vm.kind !== 'PROGRESSING') return;
    expect(vm.summary).toMatchObject({ activeDays: 12, sessionsCompleted: 8, adherenceQuality: 'BELOW_TARGET', proximity: 'BUILDING' });
    expect(vm.summary).not.toHaveProperty('displayProgress');
    expect(vm.summary).not.toHaveProperty('consistencyPercent');
  });

  it('does not fabricate zeroes while an in-progress execution blocks evaluation', () => {
    const vm = buildEvolutionViewModel({ now: NOW, lifecycle: lifecycle(), pending: null, ...NO_NOTICE,
      decision: { type: 'NO_ACTION', reason: 'IN_PROGRESS_EXECUTION' } });
    expect(vm.kind).toBe('PROGRESSING');
    if (vm.kind !== 'PROGRESSING') return;
    expect(vm.summary).toMatchObject({ proximity: null, activeDays: null, sessionsCompleted: null, adherenceQuality: null });
  });

  it('maps proximity only from authoritative decision outcomes', () => {
    expect(proximityFromDecision(progressing())).toBe('BUILDING');
    expect(proximityFromDecision(progressing({ reason: 'ADHERENCE_BELOW_THRESHOLD' }))).toBe('ON_TRACK');
    expect(proximityFromDecision({ type: 'NO_ACTION', reason: 'IN_PROGRESS_EXECUTION' })).toBeNull();
  });
});

describe('earned, renewal, deferral and career state', () => {
  it('represents earned target separately from the still-active prescription', () => {
    const vm = buildEvolutionViewModel({ now: NOW, decision: null, ...NO_NOTICE,
      lifecycle: lifecycle({ earnedLevel: 'INTERMEDIATE', activeLevel: 'BEGINNER' }),
      pending: pending({ type: 'LEVEL_PROMOTION', fromLevel: 'BEGINNER', toLevel: 'INTERMEDIATE' }) });
    expect(vm.kind).toBe('EVOLUTION_READY');
    if (vm.kind !== 'EVOLUTION_READY') return;
    expect(vm.summary).toMatchObject({ earnedLevel: 'INTERMEDIATE', activeLevel: 'BEGINNER' });
  });

  it.each([10, 57, 999])('renders Advanced cycle %i without an artificial cap', (cycleNumber) => {
    const vm = buildEvolutionViewModel({ now: NOW, lifecycle: lifecycle({ earnedLevel: 'ADVANCED', activeLevel: 'ADVANCED', cycleNumber }),
      decision: progressing(), pending: null, ...NO_NOTICE });
    expect(vm.kind === 'PROGRESSING' && vm.summary.cycleNumber).toBe(cycleNumber);
  });

  it('keeps renewal neutral and on the same level/cycle', () => {
    const vm = buildEvolutionViewModel({ now: NOW, lifecycle: lifecycle({ cycleNumber: 7 }), decision: null, ...NO_NOTICE,
      pending: pending({ type: 'MOTIVATIONAL_RENEWAL', quality: 'BELOW_TARGET', fromLevel: 'BEGINNER', toLevel: 'BEGINNER' }) });
    expect(vm.kind).toBe('EVOLUTION_READY');
    if (vm.kind !== 'EVOLUTION_READY') return;
    expect(vm.pending.fromLevel).toBe(vm.pending.toLevel);
    expect(vm.summary.cycleNumber).toBe(7);
  });

  it('keeps manual Start representable during first and second deferral', () => {
    for (const deferred of [
      pending({ deferralCount: 1, nextPromptAt: new Date('2026-06-15T00:00:00Z') }),
      pending({ deferralCount: 2, autoActivateAt: new Date('2026-06-15T00:00:00Z') }),
    ]) {
      const vm = buildEvolutionViewModel({ now: NOW, lifecycle: lifecycle(), decision: null, pending: deferred, ...NO_NOTICE });
      expect(vm.kind).toBe('EVOLUTION_DEFERRED');
      if (vm.kind !== 'EVOLUTION_DEFERRED') continue;
      expect(vm.pending.type).toBe('CYCLE_EVOLUTION');
    }
  });

  it('uses nextPromptAt only to restore the defer prompt, not activation permission', () => {
    const vm = buildEvolutionViewModel({ now: new Date('2026-06-15T00:00:00Z'), lifecycle: lifecycle(), decision: null, ...NO_NOTICE,
      pending: pending({ deferralCount: 1, nextPromptAt: new Date('2026-06-15T00:00:00Z') }) });
    expect(vm.kind).toBe('EVOLUTION_READY');
  });
});

describe('persisted auto-activation notice', () => {
  it.each(['LEVEL_PROMOTION', 'CYCLE_EVOLUTION', 'MOTIVATIONAL_RENEWAL'] as const)('represents %s with a persisted event id', (type) => {
    const vm = buildEvolutionViewModel({ now: NOW, lifecycle: lifecycle(), decision: progressing(), pending: null,
      autoActivationNotice: { eventId: `event-${type}`, type } });
    expect(vm).toMatchObject({ kind: 'AUTO_ACTIVATION_NOTICE', activatedType: type, activationEventId: `event-${type}` });
  });

  it('propagates incomplete-history truth without inventing prior cycles', () => {
    const vm = buildEvolutionViewModel({ now: NOW, lifecycle: lifecycle({ isHistoryComplete: false }), decision: progressing(), pending: null, ...NO_NOTICE });
    expect(vm.kind === 'PROGRESSING' && vm.summary.isHistoryComplete).toBe(false);
  });
});
