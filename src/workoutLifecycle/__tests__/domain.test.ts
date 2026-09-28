import { describe, expect, it } from 'vitest';

import {
  evolutionIdempotencyKey,
  isPendingEvolution,
  isProgramInstance,
  isTrainingCycle,
  isWorkoutLifecycle,
  isWorkoutLifecycleEvent,
  pendingEvolutionIdForOperation,
  programInstanceIdForOperation,
  startingLevelFromQuestionnaire,
} from '../domain';

const stamp = { toMillis: () => 1 };

describe('Workout Lifecycle V2 domain', () => {
  it('normalizes historical questionnaire experience without making it current lifecycle state', () => {
    expect(startingLevelFromQuestionnaire('never_or_starting')).toBe('BEGINNER');
    expect(startingLevelFromQuestionnaire('beginner')).toBe('BEGINNER');
    expect(startingLevelFromQuestionnaire('beg')).toBe('BEGINNER');
    expect(startingLevelFromQuestionnaire('intermediate')).toBe('INTERMEDIATE');
    expect(startingLevelFromQuestionnaire('int')).toBe('INTERMEDIATE');
    expect(startingLevelFromQuestionnaire('advanced')).toBe('ADVANCED');
    expect(startingLevelFromQuestionnaire('adv')).toBe('ADVANCED');
    expect(startingLevelFromQuestionnaire('elite')).toBe('ADVANCED');
    expect(isWorkoutLifecycle({
      startingLevel: 'BEGINNER', currentTrainingLevel: 'INTERMEDIATE',
      currentCycleId: 'cycle-2', currentCycleNumber: 2,
      activeProgramInstanceId: 'instance-2', activeContentIdentity: 'wpg-2',
      activePrescriptionIdentity: 'wp-2', initializationOrigin: 'V2_NATIVE',
      historyCompleteFrom: stamp, schemaVersion: 2, createdAt: stamp, updatedAt: stamp,
    })).toBe(true);
  });

  it('keeps level independent from an arbitrarily high Advanced cycle number', () => {
    expect(isTrainingCycle({
      cycleId: 'cycle-9001', level: 'ADVANCED', cycleNumber: 9001,
      status: 'ACTIVE', origin: 'V2_NATIVE', programInstanceId: 'instance-a',
      previousProgramInstanceId: null, startedAt: stamp, eligibleAt: null,
      completedAt: null, progressionReason: 'TEST_PRIMITIVE', schemaVersion: 2,
      createdAt: stamp, updatedAt: stamp,
    })).toBe(true);
  });

  it('allows two lifecycle instances to reference identical prescription/content identities', () => {
    const base = {
      cycleId: 'cycle-a', contentIdentity: 'wpg_same', prescriptionIdentity: 'wp_same',
      questionnaireId: 'q1', activatedAt: stamp, supersededAt: null,
      previousProgramInstanceId: null, activationReason: 'INITIAL_PROGRAM',
      schemaVersion: 2, createdAt: stamp, updatedAt: stamp,
    } as const;
    const a = { ...base, programInstanceId: programInstanceIdForOperation('cycle-a') };
    const b = { ...base, cycleId: 'cycle-b', programInstanceId: programInstanceIdForOperation('cycle-b') };
    expect(a.programInstanceId).not.toBe(b.programInstanceId);
    expect(a.contentIdentity).toBe(b.contentIdentity);
    expect(a.prescriptionIdentity).toBe(b.prescriptionIdentity);
    expect(isProgramInstance(a)).toBe(true);
    expect(isProgramInstance(b)).toBe(true);
  });

  it('validates the future domain event contract without assigning XP', () => {
    const event = {
      eventId: 'wle_123', type: 'LEVEL_PROMOTED', occurredAt: stamp,
      cycleId: 'cycle-a', programInstanceId: 'instance-a', idempotencyKey: 'promotion-a',
      payload: { from: 'BEGINNER', to: 'INTERMEDIATE' }, schemaVersion: 2,
    } as const;
    expect(isWorkoutLifecycleEvent(event)).toBe(true);
    expect(event.payload).not.toHaveProperty('xp');
  });

  it('Fase 4 — evolutionIdempotencyKey is stable for the same source instance + type and differs for a different one', () => {
    const key = evolutionIdempotencyKey({ sourceProgramInstanceId: 'wpi_a', type: 'CYCLE_EVOLUTION' });
    expect(evolutionIdempotencyKey({ sourceProgramInstanceId: 'wpi_a', type: 'CYCLE_EVOLUTION' })).toBe(key);
    expect(evolutionIdempotencyKey({ sourceProgramInstanceId: 'wpi_b', type: 'CYCLE_EVOLUTION' })).not.toBe(key);
    expect(evolutionIdempotencyKey({ sourceProgramInstanceId: 'wpi_a', type: 'LEVEL_PROMOTION' })).not.toBe(key);
  });

  it('Fase 4 — isPendingEvolution validates a real pending evolution document', () => {
    const pending = {
      pendingEvolutionId: pendingEvolutionIdForOperation('evolution:wpi_a:LEVEL_PROMOTION'),
      type: 'LEVEL_PROMOTION', status: 'READY',
      sourceCycleId: 'cyc_a', sourceProgramInstanceId: 'wpi_a',
      sourcePrescriptionInputSnapshotId: 'pis_a',
      fromLevel: 'BEGINNER', toLevel: 'INTERMEDIATE', quality: 'GOOD',
      sessionsCompletedAtEarn: 18, adherenceAtEarnBp: 7500,
      plan: { planId: 'wp_x' },
      targetContentIdentity: 'wpg_x', targetPrescriptionIdentity: 'wp_x', targetProgramInstanceId: 'wpi_b',
      targetQuestionnaireId: 'q1', targetQuestionnaireVersion: 1,
      targetTemplateId: 'T004', targetTemplateVersion: 2, targetTemplateSourceVersion: '2.0.0', targetTemplateContentHash: 'h',
      earnedAt: stamp, deferralCount: 0, nextPromptAt: null, autoActivateAt: null,
      idempotencyKey: 'evolution:wpi_a:LEVEL_PROMOTION', schemaVersion: 2, createdAt: stamp, updatedAt: stamp,
    } as const;
    expect(isPendingEvolution(pending)).toBe(true);
    expect(isPendingEvolution({ ...pending, status: 'BOGUS' })).toBe(false);
    expect(isPendingEvolution({ ...pending, deferralCount: 3 })).toBe(false);
  });
});
