/** Opt-in real Firestore Emulator coverage for Workout Lifecycle V2. */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDocs, setDoc, Timestamp } from 'firebase/firestore';

const enabled = process.env.WORKOUT_LIFECYCLE_INTEGRATION === '1';
const PROJECT_ID = 'ajfit-rules-test';
const UID = 'alice';
let testEnv: RulesTestEnvironment;

const mocks = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock('../../lib/firebase', () => ({ get db() { return mocks.db; } }));

import {
  activateProgramInstance,
  ensureWorkoutLifecycleForLegacyActiveProgram,
  lifecycleAt,
  listProgramInstances,
  listTrainingCycles,
  listWorkoutLifecycleEventsForProgramInstance,
  loadWorkoutLifecycle,
  recoverWorkoutLifecyclePartialState,
} from '../workoutLifecycle';
import { installWorkoutLifecycleAuthorityFixture, resetWorkoutLifecycleAuthorityFixture } from './workoutLifecycleAuthorityFixture';

describe.skipIf(!enabled)('Workout Lifecycle V2 — real Firestore Emulator integration', () => {
  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: { rules: readFileSync(resolve(__dirname, '../../../firestore.rules'), 'utf8') },
    });
    mocks.db = testEnv.authenticatedContext(UID, { email: 'alice@example.com', email_verified: true }).firestore();
    installWorkoutLifecycleAuthorityFixture(testEnv, UID);
  });
  afterAll(async () => {
    resetWorkoutLifecycleAuthorityFixture();
    await testEnv.cleanup();
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, 'users', UID), {
        profile: { name: 'Alice', email: 'alice@example.com' },
        preferences: { language: 'pt-BR', units: 'system', theme: 'dark' },
        subscription: {},
        metadata: { role: 'user', createdAt: Timestamp.now(), updatedAt: Timestamp.now() },
      });
      await setDoc(doc(db, 'users', UID, 'questionnaires', 'q1'), {
        answers: { level: 'beginner' }, version: 1, createdAt: Timestamp.now(),
      });
      for (const [programId, prescriptionId] of [['program-a', 'rx-a'], ['program-b', 'rx-b'], ['program-c', 'rx-a']]) {
        await setDoc(doc(db, 'users', UID, 'workoutPrograms', programId), {
          programId, prescriptionId, questionnaireId: 'q1', status: 'active',
        });
      }
    });
  });

  it('bootstraps a V1 baseline deterministically without inventing prior cycles', async () => {
    const input = {
      contentIdentity: 'program-a', prescriptionIdentity: 'rx-a', questionnaireId: 'q1',
      questionnaireExperienceLevel: 'beginner' as const, activatedAt: Timestamp.fromMillis(1_000),
    };
    const [a, b] = await Promise.all([
      ensureWorkoutLifecycleForLegacyActiveProgram(UID, input),
      ensureWorkoutLifecycleForLegacyActiveProgram(UID, input),
    ]);
    expect(a.lifecycle.activeProgramInstanceId).toBe(b.lifecycle.activeProgramInstanceId);
    expect(a.lifecycle.initializationOrigin).toBe('V1_MIGRATION_BASELINE');
    expect(a.cycle.cycleNumber).toBe(1);
    expect(a.cycle.progressionReason).toContain('NO_PRIOR_HISTORY_INFERRED');
    expect((await getDocs(collection(mocks.db as never, 'users', UID, 'trainingCycles'))).size).toBe(1);
  });

  it('rejects incomplete legacy input instead of inventing a starting level', async () => {
    await expect(ensureWorkoutLifecycleForLegacyActiveProgram(UID, {
      contentIdentity: 'program-a', prescriptionIdentity: 'rx-a', questionnaireId: 'q1',
      questionnaireExperienceLevel: null, activatedAt: Timestamp.fromMillis(1_000),
    })).rejects.toThrow('WORKOUT_LIFECYCLE_STARTING_LEVEL_UNKNOWN');
    expect(await loadWorkoutLifecycle(UID)).toBeNull();
  });

  it('converges concurrent multi-device activation on one deterministic ProgramInstance', async () => {
    const baseline = await ensureWorkoutLifecycleForLegacyActiveProgram(UID, {
      contentIdentity: 'program-a', prescriptionIdentity: 'rx-a', questionnaireId: 'q1',
      questionnaireExperienceLevel: 'beginner', activatedAt: Timestamp.fromMillis(1_000),
    });
    const input = {
      uid: UID,
      idempotencyKey: 'same-transition-from-two-devices',
      expectedActiveProgramInstanceId: baseline.programInstance.programInstanceId,
      contentIdentity: 'program-b',
      prescriptionIdentity: 'rx-b',
      questionnaireId: 'q1',
      activationReason: 'V1_AUTOMATIC_PROGRESSION' as const,
      nextCycle: {
        level: 'INTERMEDIATE' as const,
        cycleNumber: 1,
        progressionReason: 'TEST_MULTI_DEVICE',
      },
    };

    const [first, second] = await Promise.all([
      activateProgramInstance(input),
      activateProgramInstance(input),
    ]);

    expect(first.programInstance.programInstanceId).toBe(second.programInstance.programInstanceId);
    expect(await listProgramInstances(UID)).toHaveLength(2);
    expect(await listTrainingCycles(UID)).toHaveLength(2);
    const instanceEvents = await listWorkoutLifecycleEventsForProgramInstance(
      UID,
      first.programInstance.programInstanceId,
    );
    expect(instanceEvents).toHaveLength(1);
    expect(instanceEvents[0].programInstanceId).toBe(first.programInstance.programInstanceId);
  });

  it('persists reconstructable A → B → C history with level and cycle independent', async () => {
    const a = await ensureWorkoutLifecycleForLegacyActiveProgram(UID, {
      contentIdentity: 'program-a', prescriptionIdentity: 'rx-a', questionnaireId: 'q1',
      questionnaireExperienceLevel: 'beginner', activatedAt: Timestamp.fromMillis(1_000),
    });
    const b = await activateProgramInstance({
      uid: UID, idempotencyKey: 'promote-to-intermediate',
      expectedActiveProgramInstanceId: a.programInstance.programInstanceId,
      contentIdentity: 'program-b', prescriptionIdentity: 'rx-b', questionnaireId: 'q1',
      activationReason: 'V1_AUTOMATIC_PROGRESSION',
      nextCycle: { level: 'INTERMEDIATE', cycleNumber: 1, progressionReason: 'TEST_PRIMITIVE_PROMOTION' },
    });
    const c = await activateProgramInstance({
      uid: UID, idempotencyKey: 'intermediate-cycle-2',
      expectedActiveProgramInstanceId: b.programInstance.programInstanceId,
      contentIdentity: 'program-c', prescriptionIdentity: 'rx-a', questionnaireId: 'q1',
      activationReason: 'V1_AUTOMATIC_PROGRESSION',
      nextCycle: { level: 'INTERMEDIATE', cycleNumber: 2, progressionReason: 'TEST_PRIMITIVE_CYCLE' },
    });
    const retry = await activateProgramInstance({
      uid: UID, idempotencyKey: 'intermediate-cycle-2',
      expectedActiveProgramInstanceId: b.programInstance.programInstanceId,
      contentIdentity: 'program-c', prescriptionIdentity: 'rx-a', questionnaireId: 'q1',
      activationReason: 'V1_AUTOMATIC_PROGRESSION',
      nextCycle: { level: 'INTERMEDIATE', cycleNumber: 2, progressionReason: 'TEST_PRIMITIVE_CYCLE' },
    });

    expect(retry.programInstance.programInstanceId).toBe(c.programInstance.programInstanceId);
    const instances = await listProgramInstances(UID);
    const cycles = await listTrainingCycles(UID);
    expect(instances).toHaveLength(3);
    expect(cycles).toHaveLength(3);
    const byId = new Map(instances.map((item) => [item.programInstanceId, item]));
    expect(byId.get(b.programInstance.programInstanceId)?.previousProgramInstanceId).toBe(a.programInstance.programInstanceId);
    expect(byId.get(c.programInstance.programInstanceId)?.previousProgramInstanceId).toBe(b.programInstance.programInstanceId);
    expect(c.lifecycle).toMatchObject({ startingLevel: 'BEGINNER', currentTrainingLevel: 'INTERMEDIATE', currentCycleNumber: 2 });
    expect(instances.filter((item) => item.prescriptionIdentity === 'rx-a')).toHaveLength(2);
    expect((await lifecycleAt(UID, Timestamp.fromMillis(1_000)))?.programInstance.contentIdentity).toBe('program-a');
    expect((await loadWorkoutLifecycle(UID))?.programInstance.contentIdentity).toBe('program-c');
  });

  it('8B state-missing repair derives starting level/history boundary from persisted V2 history', async () => {
    const a = await ensureWorkoutLifecycleForLegacyActiveProgram(UID, {
      contentIdentity: 'program-a', prescriptionIdentity: 'rx-a', questionnaireId: 'q1',
      questionnaireExperienceLevel: 'beginner', activatedAt: Timestamp.fromMillis(1_000),
    });
    const b = await activateProgramInstance({
      uid: UID, idempotencyKey: 'state-loss-after-promotion',
      expectedActiveProgramInstanceId: a.programInstance.programInstanceId,
      contentIdentity: 'program-b', prescriptionIdentity: 'rx-b', questionnaireId: 'q1',
      activationReason: 'V1_AUTOMATIC_PROGRESSION',
      nextCycle: { level: 'INTERMEDIATE', cycleNumber: 1, progressionReason: 'LEVEL_PROMOTION' },
    });
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await deleteDoc(doc(ctx.firestore(), 'users', UID, 'workoutLifecycleState', 'current'));
    });

    const repaired = await recoverWorkoutLifecyclePartialState(UID);
    expect(repaired.classification).toBe('STATE_MISSING_WITH_COHERENT_ACTIVE_PAIR');
    expect(repaired.lifecycle?.lifecycle).toMatchObject({
      startingLevel: 'BEGINNER', currentTrainingLevel: 'INTERMEDIATE',
      activeProgramInstanceId: b.programInstance.programInstanceId,
    });
    expect(repaired.lifecycle?.lifecycle.historyCompleteFrom.toMillis()).toBe(a.cycle.createdAt.toMillis());
  }, 30_000);

  // Fase 6 §101/B-F: migration matrix — every V1 starting level gets a
  // deterministic, non-fabricated baseline (cycle 1, no earned history).
  it.each(['beginner', 'intermediate', 'advanced'] as const)(
    'V1 %s bootstraps a safe baseline with no fabricated cycle/earned history',
    async (level) => {
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await setDoc(doc(ctx.firestore(), 'users', UID, 'questionnaires', 'q1'), {
          answers: { level }, version: 1, createdAt: Timestamp.now(),
        });
      });
      const baseline = await ensureWorkoutLifecycleForLegacyActiveProgram(UID, {
        contentIdentity: 'program-a', prescriptionIdentity: 'rx-a', questionnaireId: 'q1',
        questionnaireExperienceLevel: level, activatedAt: Timestamp.fromMillis(1_000),
      });
      expect(baseline.lifecycle.startingLevel).toBe(level.toUpperCase());
      expect(baseline.lifecycle.currentTrainingLevel).toBe(level.toUpperCase());
      expect(baseline.cycle.cycleNumber).toBe(1);
      expect(baseline.cycle.progressionReason).toContain('NO_PRIOR_HISTORY_INFERRED');
      expect(baseline.lifecycle.initializationOrigin).toBe('V1_MIGRATION_BASELINE');
    },
  );

  // Fase 6 §N/§102: an account already on V2 must take the fast path — the
  // legacy bootstrap is a safe no-op, never re-derives or overwrites an
  // already-established baseline (e.g. from a since-changed V1 pointer).
  it('§N already-V2 accounts are a no-op on the legacy bootstrap — never re-derived, never overwritten', async () => {
    const first = await ensureWorkoutLifecycleForLegacyActiveProgram(UID, {
      contentIdentity: 'program-a', prescriptionIdentity: 'rx-a', questionnaireId: 'q1',
      questionnaireExperienceLevel: 'beginner', activatedAt: Timestamp.fromMillis(1_000),
    });
    // A second call with entirely different (and higher-level) legacy input —
    // as if the V1 pointer had since drifted — must not silently take over.
    const second = await ensureWorkoutLifecycleForLegacyActiveProgram(UID, {
      contentIdentity: 'program-z', prescriptionIdentity: 'rx-z', questionnaireId: 'q1',
      questionnaireExperienceLevel: 'advanced', activatedAt: Timestamp.fromMillis(999_999),
    });
    expect(second.lifecycle.activeContentIdentity).toBe(first.lifecycle.activeContentIdentity);
    expect(second.lifecycle.startingLevel).toBe('BEGINNER');
    expect((await listTrainingCycles(UID))).toHaveLength(1);
    expect((await listProgramInstances(UID))).toHaveLength(1);
  });

  it.each([
    ['STATE_MISSING_CYCLE_AND_INSTANCE', true, true],
    ['STATE_MISSING_CYCLE', true, false],
    ['STATE_MISSING_INSTANCE', false, true],
  ] as const)('8B partial migration %s repairs only missing authoritative referents', async (expected, removeCycle, removeInstance) => {
    const baseline = await ensureWorkoutLifecycleForLegacyActiveProgram(UID, {
      contentIdentity: 'program-a', prescriptionIdentity: 'rx-a', questionnaireId: 'q1',
      questionnaireExperienceLevel: 'beginner', activatedAt: Timestamp.fromMillis(1_000),
    });
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const rawDb = ctx.firestore();
      if (removeCycle) await deleteDoc(doc(rawDb, 'users', UID, 'trainingCycles', baseline.cycle.cycleId));
      if (removeInstance) await deleteDoc(doc(rawDb, 'users', UID, 'programInstances', baseline.programInstance.programInstanceId));
    });
    const [a, b] = await Promise.all([
      recoverWorkoutLifecyclePartialState(UID),
      recoverWorkoutLifecyclePartialState(UID),
    ]);
    expect([a.classification, b.classification]).toContain(expected);
    const recovered = await loadWorkoutLifecycle(UID);
    expect(recovered?.lifecycle.activeContentIdentity).toBe('program-a');
    expect(await listTrainingCycles(UID)).toHaveLength(1);
    expect(await listProgramInstances(UID)).toHaveLength(1);
  }, 30_000);

  it('8B state-missing recovery uses one coherent V2 active pair and never consults a stale legacy mirror', async () => {
    const baseline = await ensureWorkoutLifecycleForLegacyActiveProgram(UID, {
      contentIdentity: 'program-a', prescriptionIdentity: 'rx-a', questionnaireId: 'q1',
      questionnaireExperienceLevel: 'beginner', activatedAt: Timestamp.fromMillis(1_000),
    });
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const rawDb = ctx.firestore();
      await deleteDoc(doc(rawDb, 'users', UID, 'workoutLifecycleState', 'current'));
      await setDoc(doc(rawDb, 'users', UID, 'workoutProgramState', 'active'), {
        programId: 'program-b', programInstanceId: 'legacy-drift', updatedAt: Timestamp.now(),
      });
    });
    const result = await recoverWorkoutLifecyclePartialState(UID);
    expect(result.classification).toBe('STATE_MISSING_WITH_COHERENT_ACTIVE_PAIR');
    expect(result.lifecycle?.lifecycle.activeProgramInstanceId).toBe(baseline.programInstance.programInstanceId);
    expect(result.lifecycle?.lifecycle.activeContentIdentity).toBe('program-a');
  }, 30_000);

  it('8B ambiguous partial state fails safely without inventing an instance or history', async () => {
    const baseline = await ensureWorkoutLifecycleForLegacyActiveProgram(UID, {
      contentIdentity: 'program-a', prescriptionIdentity: 'rx-a', questionnaireId: 'q1',
      questionnaireExperienceLevel: 'beginner', activatedAt: Timestamp.fromMillis(1_000),
    });
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const rawDb = ctx.firestore();
      await deleteDoc(doc(rawDb, 'users', UID, 'workoutLifecycleState', 'current'));
      await deleteDoc(doc(rawDb, 'users', UID, 'programInstances', baseline.programInstance.programInstanceId));
    });
    const result = await recoverWorkoutLifecyclePartialState(UID);
    expect(result).toMatchObject({ classification: 'UNRECOVERABLE', recovered: false, lifecycle: null });
    expect(await listProgramInstances(UID)).toHaveLength(0);
    expect(await listTrainingCycles(UID)).toHaveLength(1);
  }, 30_000);
});
