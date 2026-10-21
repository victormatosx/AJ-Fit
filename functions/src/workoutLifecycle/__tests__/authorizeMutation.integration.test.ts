import { deleteApp,initializeApp,type App } from 'firebase-admin/app';
import { Timestamp,getFirestore,type Firestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/v2';
import { afterAll,beforeAll,beforeEach,describe,expect,it,vi } from 'vitest';

import {
  authoritativeEarnedFact,
  authoritativeEarnedFactFullScanOracleForTest,
  authorizeWorkoutLifecycleMutationHandler,
  initializeWorkoutProgramV127Handler,
} from '../authorizeMutation';
import { countEarnedIntermediateCycles } from '../prescriptionEngine/progressionEngineV2/earnedCycles';
import { effectivePrescriptionInputsFromAnswers } from '../prescriptionEngine/workoutLifecycle/prescriptionInputs';
import { weekdayOfLocalDate } from '../scheduleEngine/calendar';
import { resolveWorkoutSchedule } from '../scheduleEngine/resolver';
import { seedRealPrescriptionCatalog } from './realCatalogFixture';

const enabled = process.env.WORKOUT_LIFECYCLE_AUTHORITY_INTEGRATION === '1';
const UID = 'authority-adversary';

/** Minimal but complete authoritative answers — enough for `selectTemplate`/`generateWorkoutPrescription` to succeed against the real catalog seeded by `seedRealPrescriptionCatalog`. */
function completeInputs(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sex: 'm', goal: 'gain_muscle', level: 'beginner', days: 4, duration: '60', place: 'gym',
    trainingDays: ['MON', 'TUE', 'THU', 'FRI'], equipment: [], style: [], muscleFocus: [],
    specialConditions: ['none'],
    pregnancyScreening: null, postpartumScreening: null, functionalScreening: null,
    lipedemaScreening: null, dizzinessScreening: null, postSurgicalScreening: null,
    medicalRestrictionScreening: null,
    ...overrides,
  };
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function lifecycleStableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function lifecycleEventId(type: string, idempotencyKey: string): string {
  return `wle_${lifecycleStableHash(`${type}:${idempotencyKey}`)}`;
}

function snapshotIdFor(source: string, inputs: Record<string, unknown>): string {
  let hash = 0x811c9dc5;
  const identity = canonical({ schemaVersion: 1, source, inputs });
  for (let index = 0; index < identity.length; index += 1) {
    hash ^= identity.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `pis_${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function exercise(exerciseIndex: number, exerciseId: string, statuses: string[]) {
  return {
    exerciseIndex,
    exerciseId,
    prescribedSets: statuses.length,
    prescribedReps: '10',
    prescribedDuration: null,
    prescribedCycles: null,
    sets: statuses.map((status, setIndex) => ({
      setIndex, status, actualReps: status === 'COMPLETED' ? 10 : null,
      weightKg: status === 'COMPLETED' ? 20 : null, actualDurationSeconds: null,
    })),
  };
}

describe.skipIf(!enabled)('Workout Lifecycle authority — real Firestore Emulator', () => {
  let app: App;
  let db: Firestore;

  beforeAll(async () => {
    app = initializeApp({ projectId: 'ajfit-rules-test' }, 'workout-lifecycle-authority-integration');
    db = getFirestore(app);
    await seedRealPrescriptionCatalog(db);
  });

  afterAll(async () => deleteApp(app));

  beforeEach(async () => {
    await db.recursiveDelete(db.collection('users').doc(UID));
    const root = db.collection('users').doc(UID);
    await Promise.all([
      root.collection('workoutLifecycleState').doc('current').set({
        currentTrainingLevel: 'BEGINNER', currentCycleId: 'cyc_active', currentCycleNumber: 1,
        activeProgramInstanceId: 'wpi_active', activeContentIdentity: 'wpg_active',
        activePrescriptionIdentity: 'rx_active',
      }),
      root.collection('programInstances').doc('wpi_active').set({
        programInstanceId: 'wpi_active', cycleId: 'cyc_active', contentIdentity: 'wpg_active',
        prescriptionIdentity: 'rx_active', activatedAt: Timestamp.fromMillis(Date.now() - 86_400_000),
        prescriptionInputSnapshot: {
          snapshotId: 'pis_active', schemaVersion: 1, source: 'QUESTIONNAIRE_BASELINE',
          inputs: { level: 'beginner', trainingDays: ['MON', 'WED', 'FRI'] },
        },
      }),
      root.collection('trainingCycles').doc('cyc_active').set({
        cycleId: 'cyc_active', level: 'BEGINNER', cycleNumber: 1, status: 'ACTIVE',
        programInstanceId: 'wpi_active',
      }),
      root.collection('workoutPrograms').doc('wpg_active').set({
        programId: 'wpg_active', prescriptionId: 'rx_active',
        sessions: [{
          name: 'Full body',
          exercises: [{ exerciseId: 'squat', sets: 3 }, { exerciseId: 'row', sets: 3 }],
        }],
      }),
    ]);
  });

  async function finishRequest() {
    return authorizeWorkoutLifecycleMutationHandler({
      auth: { uid: UID }, data: { operation: 'FINISH_EXECUTION', executionId: 'exec_1' },
    } as never, db);
  }

  it('rejects an omitted prescribed exercise before granting terminal execution authority', async () => {
    await db.collection('users').doc(UID).collection('workoutExecutions').doc('exec_1').set({
      status: 'IN_PROGRESS', programInstanceId: 'wpi_active', sessionIndex: 0,
      exercises: [exercise(0, 'squat', ['COMPLETED', 'COMPLETED', 'COMPLETED'])],
    });
    await expect(finishRequest()).rejects.toMatchObject({ code: 'permission-denied' });
    expect((await db.collection('users').doc(UID).collection('workoutLifecycleAuthorityGrants').doc('current').get()).exists)
      .toBe(false);
  });

  it('rejects duplicate/unknown prescription evidence and grants only an exact immutable session shape', async () => {
    const ref = db.collection('users').doc(UID).collection('workoutExecutions').doc('exec_1');
    await ref.set({
      status: 'IN_PROGRESS', programInstanceId: 'wpi_active', sessionIndex: 0,
      exercises: [
        exercise(0, 'squat', ['COMPLETED', 'COMPLETED', 'COMPLETED']),
        exercise(0, 'unknown', ['COMPLETED', 'COMPLETED', 'COMPLETED']),
      ],
    });
    await expect(finishRequest()).rejects.toMatchObject({ code: 'permission-denied' });

    await ref.set({
      status: 'IN_PROGRESS', programInstanceId: 'wpi_active', sessionIndex: 0,
      exercises: [
        exercise(0, 'squat', ['COMPLETED', 'COMPLETED', 'SKIPPED']),
        exercise(1, 'row', ['COMPLETED', 'SKIPPED', 'SKIPPED']),
      ],
    });
    await expect(finishRequest()).resolves.toMatchObject({ grantId: 'current' });
    const grant = (await db.collection('users').doc(UID)
      .collection('workoutLifecycleAuthorityGrants').doc('current').get()).data();
    expect(grant).toMatchObject({ uid: UID, operation: 'FINISH_EXECUTION', executionId: 'exec_1', schemaVersion: 1 });
  });

  it.each([
    ['NONE', false],
    ['NONE', true],
    ['SESSION', false],
    ['SESSION', true],
    ['PERMANENT', false],
    ['PERMANENT', true],
  ] as const)('authorizes V2 finish with substitution=%s and cardio=%s', async (scope, withCardio) => {
    const root = db.collection('users').doc(UID);
    await Promise.all([
      root.collection('programInstances').doc('wpi_active').update({
        prescriptionInputSnapshot: {
          snapshotId: 'pis_active', schemaVersion: 1, source: 'QUESTIONNAIRE_BASELINE',
          inputs: completeInputs({ place: 'home', equipment: ['bodyweight'] }),
        },
      }),
      root.collection('workoutPrograms').doc('wpg_active').update({
        environment: 'home',
        sessions: [{ name: 'Legs', exercises: [{ exerciseId: 'barbell-back-squat', sets: 3 }] }],
      }),
    ]);
    const record = exercise(
      0,
      scope === 'NONE' ? 'barbell-back-squat' : 'bodyweight-squat',
      ['COMPLETED', 'COMPLETED', 'COMPLETED'],
    );
    await root.collection('workoutExecutions').doc('exec_1').set({
      status: 'IN_PROGRESS', programId: 'wpg_active', programInstanceId: 'wpi_active', sessionIndex: 0,
      exercises: [{
        ...record,
        prescribedExerciseId: 'barbell-back-squat',
        ...(scope === 'NONE' ? {} : { substitution: { scope, appliedAt: Timestamp.now() } }),
      }],
      ...(withCardio ? { cardio: { status: 'COMPLETED', actualDurationSeconds: 600, completedAt: Timestamp.now() } } : {}),
    });
    await expect(finishRequest()).resolves.toMatchObject({ grantId: 'current' });
  });

  it('denies a changed effective exercise that lacks server-valid substitution evidence', async () => {
    const root = db.collection('users').doc(UID);
    await root.collection('workoutPrograms').doc('wpg_active').update({
      sessions: [{ name: 'Legs', exercises: [{ exerciseId: 'barbell-back-squat', sets: 3 }] }],
    });
    await root.collection('workoutExecutions').doc('exec_1').set({
      status: 'IN_PROGRESS', programId: 'wpg_active', programInstanceId: 'wpi_active', sessionIndex: 0,
      exercises: [{
        ...exercise(0, 'goblet-squat', ['COMPLETED', 'COMPLETED', 'COMPLETED']),
        prescribedExerciseId: 'barbell-back-squat',
      }],
    });
    await expect(finishRequest()).rejects.toMatchObject({
      code: 'permission-denied', message: 'execution_substitution_not_authoritative',
      details: { reason: 'substitution_marker_missing' },
    });
  });

  it('finishes against the execution-bound prescription after a later active-program adaptation', async () => {
    const root = db.collection('users').doc(UID);
    await root.collection('workoutExecutions').doc('exec_1').set({
      status: 'IN_PROGRESS', programId: 'wpg_active', programInstanceId: 'wpi_active', sessionIndex: 0,
      exercises: [
        exercise(0, 'squat', ['COMPLETED', 'COMPLETED', 'COMPLETED']),
        exercise(1, 'row', ['COMPLETED', 'COMPLETED', 'COMPLETED']),
      ],
    });
    await Promise.all([
      root.collection('workoutLifecycleState').doc('current').update({
        activeProgramInstanceId: 'wpi_future', activeContentIdentity: 'wpg_future', activePrescriptionIdentity: 'rx_future',
      }),
      root.collection('programInstances').doc('wpi_future').set({
        programInstanceId: 'wpi_future', contentIdentity: 'wpg_future', prescriptionIdentity: 'rx_future',
      }),
      root.collection('workoutPrograms').doc('wpg_future').set({
        programId: 'wpg_future', prescriptionId: 'rx_future',
        sessions: [{ name: 'Future', exercises: [{ exerciseId: 'different', sets: 1 }] }],
      }),
    ]);
    await expect(finishRequest()).resolves.toMatchObject({ grantId: 'current' });
  });

  it('rejects activation without an authoritative pending evolution', async () => {
    await expect(authorizeWorkoutLifecycleMutationHandler({
      auth: { uid: UID },
      data: {
        operation: 'ACTIVATE', sourceProgramInstanceId: 'wpi_active', sourceCycleId: 'cyc_active',
        pendingEvolutionId: 'wpe_forged', targetProgramInstanceId: 'wpi_forged',
      },
    } as never, db)).rejects.toMatchObject({ code: 'aborted' });
  });

  // QA_TRANSITION forensic follow-up (docs/workout-lifecycle/v2/qa/): a real
  // "PREPARAR PRÓXIMA EVOLUÇÃO" -> ACTIVATE round trip on a QA_TRANSITION
  // account produced a 403 `activation_does_not_match_authoritative_pending`
  // whose specific mismatching clause could not be attributed from Cloud
  // Logging (the six comparisons were OR'd into one throw). These tests
  // pin down that the diagnostic logging added alongside the throw changes
  // NOTHING about which requests are authorized vs. denied — only ONE test
  // below authorizes; every mismatch variant must still deny with the exact
  // same HttpsError code+message as before this change.
  describe('ACTIVATE — activation must match the authoritative pending evolution byte-for-byte', () => {
    const PENDING_ID = 'wpe_1';
    const IDEMPOTENCY_KEY = `activation:${PENDING_ID}`;
    const LEVEL_PROMOTED = 'LEVEL_PROMOTED';
    const validInputs = completeInputs({ level: 'intermediate' });
    const validPlan = {
      planId: 'rx_promoted', templateId: 'T001',
      sessions: [{ exercises: [{ exerciseId: 'lat-pulldown', sets: 3 }] }],
    };
    const validSnapshot = {
      snapshotId: snapshotIdFor('LEVEL_PROMOTION', validInputs), schemaVersion: 1,
      source: 'LEVEL_PROMOTION', inputs: validInputs,
    };

    async function seedPending() {
      await db.collection('users').doc(UID).collection('pendingEvolutions').doc('current').set({
        pendingEvolutionId: PENDING_ID, status: 'READY', type: 'LEVEL_PROMOTION',
        fromLevel: 'BEGINNER', toLevel: 'INTERMEDIATE', quality: 'GOOD',
        sourceProgramInstanceId: 'wpi_active', sourceCycleId: 'cyc_active',
        targetProgramInstanceId: 'wpi_promoted', targetContentIdentity: 'wpg_promoted',
        targetPrescriptionIdentity: 'rx_promoted',
        plan: validPlan, targetPrescriptionInputSnapshot: validSnapshot,
        idempotencyKey: IDEMPOTENCY_KEY,
      });
    }

    function activateRequest(overrides: Record<string, unknown> = {}) {
      return {
        auth: { uid: UID },
        data: {
          operation: 'ACTIVATE', sourceProgramInstanceId: 'wpi_active', sourceCycleId: 'cyc_active',
          pendingEvolutionId: PENDING_ID,
          targetProgramInstanceId: 'wpi_promoted', targetContentIdentity: 'wpg_promoted',
          targetPrescriptionIdentity: 'rx_promoted',
          targetTrainingLevel: 'INTERMEDIATE', targetCycleNumber: 1,
          questionnaireId: 'q1', questionnaireVersion: 1,
          targetProgramSource: 'evolution_activation',
          targetTemplateVersion: 1, targetTemplateSourceVersion: '1.0.0', targetTemplateContentHash: 'a'.repeat(64),
          eventType: LEVEL_PROMOTED, eventId: lifecycleEventId(LEVEL_PROMOTED, IDEMPOTENCY_KEY),
          idempotencyKey: IDEMPOTENCY_KEY,
          targetPlan: validPlan, targetPrescriptionInputSnapshot: validSnapshot,
          ...overrides,
        },
      } as never;
    }

    it('a fully matching ACTIVATE is authorized (case 1: valid activation)', async () => {
      await seedPending();
      const result = await authorizeWorkoutLifecycleMutationHandler(activateRequest(), db);
      expect(result.grantId).toBe('current');
    });

    it.each([
      ['targetProgramInstanceId (case 2)', { targetProgramInstanceId: 'wpi_forged' }],
      ['targetContentIdentity (case 3)', { targetContentIdentity: 'wpg_forged' }],
      ['targetPrescriptionIdentity (case 4)', { targetPrescriptionIdentity: 'rx_forged' }],
      ['eventType (case 5)', {
        eventType: 'EVOLUTION_ACTIVATED',
        eventId: lifecycleEventId('EVOLUTION_ACTIVATED', IDEMPOTENCY_KEY),
      }],
      ['targetPlan (case 6)', {
        targetPlan: { ...validPlan, sessions: [{ exercises: [{ exerciseId: 'lat-pulldown', sets: 5 }] }] },
      }],
      ['targetPrescriptionInputSnapshot (case 7)', {
        targetPrescriptionInputSnapshot: { ...validSnapshot, inputs: { ...validInputs, days: 5 } },
      }],
    ])('mismatch of %s is still denied with the exact same reason as before instrumentation', async (_label, overrides) => {
      await seedPending();
      await expect(authorizeWorkoutLifecycleMutationHandler(activateRequest(overrides), db))
        .rejects.toMatchObject({ code: 'permission-denied', message: 'activation_does_not_match_authoritative_pending' });
      // No side effect leaked from a denied ACTIVATE — same as pre-existing behavior.
      expect((await db.collection('users').doc(UID)
        .collection('workoutLifecycleAuthorityGrants').doc('current').get()).exists).toBe(false);
    });

    it('mismatch of expected level/cycle (case 8: a real subcondition, distinct error message) is still denied', async () => {
      await seedPending();
      await expect(authorizeWorkoutLifecycleMutationHandler(activateRequest({ targetCycleNumber: 2 }), db))
        .rejects.toMatchObject({ code: 'permission-denied', message: 'activation_cycle_semantics_not_authoritative' });
    });

    it('case 9: the diagnostic log identifies the mismatched field and carries only hashes/booleans/ids — never plan, questionnaire, or snapshot content', async () => {
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
      try {
        await seedPending();
        const forgedPlan = {
          ...validPlan,
          sessions: [{ exercises: [{ exerciseId: 'lat-pulldown', sets: 5 }] }],
        };
        await expect(authorizeWorkoutLifecycleMutationHandler(
          activateRequest({ targetPlan: forgedPlan }), db,
        )).rejects.toMatchObject({ code: 'permission-denied' });

        expect(warnSpy).toHaveBeenCalled();
        const [message, context] = warnSpy.mock.calls[warnSpy.mock.calls.length - 1] as [string, Record<string, unknown>];
        expect(message).toContain('activation_does_not_match_authoritative_pending');
        expect(context.mismatchFields).toBe('targetPlan');

        const serialized = JSON.stringify(context);
        // No raw exercise/plan/questionnaire content ever reaches the log —
        // only sha256 hex fingerprints, booleans, short ids, and level/cycle
        // enum-like strings appear as values.
        expect(serialized).not.toContain('lat-pulldown');
        expect(serialized).not.toContain('exerciseId');
        expect(serialized).not.toContain('sessions');
        expect(serialized).not.toContain('specialConditions');
        expect(serialized).not.toContain(JSON.stringify(validInputs).slice(0, 20));
        for (const [key, value] of Object.entries(context)) {
          if (typeof value !== 'string' || !/Fingerprint$|Hash$/.test(key)) continue;
          expect(value).toMatch(/^[0-9a-f]{64}$/);
        }
      } finally {
        warnSpy.mockRestore();
      }
    });
  });

  it('requires Firebase Auth before reading or granting lifecycle authority', async () => {
    await expect(authorizeWorkoutLifecycleMutationHandler({
      auth: null, data: { operation: 'FINISH_EXECUTION', executionId: 'exec_1' },
    } as never, db)).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  // Phase 10D-V VG-C (docs/workout-lifecycle/v2/architecture/
  // 24_PHASE_10DV_VERIFICATION_CLOSURE.md): MIGRATE (V1→V2 baseline
  // bootstrap) had no direct backend-level adversarial coverage — only an
  // indirect proof via a client-side test fixture that simulates (not
  // exercises) the real authorizer. These tests call
  // `authorizeWorkoutLifecycleMutationHandler` directly, the same way the
  // ADAPT/RECOVER/PREPARE tests above do.
  it('MIGRATE (and INITIALIZE) are denied once V2 lifecycle state already exists — repeat/concurrent migration cannot create a second baseline', async () => {
    // The outer beforeEach already seeded a full V2 lifecycle for UID — this
    // is exactly "repeat migration after the first succeeded" (C4) and
    // "existing complete V2 lifecycle" (C7): the very first check in
    // `validateRequest`'s INITIALIZE/MIGRATE branch is `state.exists`, before
    // any questionnaire/content generation ever runs.
    const inputs = completeInputs();
    await expect(authorizeWorkoutLifecycleMutationHandler({
      auth: { uid: UID },
      data: {
        operation: 'MIGRATE',
        targetProgramInstanceId: 'wpi_attacker', targetCycleId: 'cyc_attacker',
        questionnaireId: 'q1', questionnaireVersion: 1,
        targetPrescriptionInputSnapshot: {
          snapshotId: snapshotIdFor('QUESTIONNAIRE_BASELINE', inputs),
          schemaVersion: 1, source: 'QUESTIONNAIRE_BASELINE', inputs,
        },
      },
    } as never, db)).rejects.toMatchObject({ code: 'aborted', message: 'lifecycle_already_initialized' });
    // Concurrent MIGRATE calls resolve to the same guard: whichever request's
    // read of `workoutLifecycleState/current` observes the (already-existing,
    // seeded) state is rejected the same way — there is no window where two
    // MIGRATE calls can both proceed past this check for the same account,
    // since it is a plain document read with no partial/optimistic path.
    await expect(authorizeWorkoutLifecycleMutationHandler({
      auth: { uid: UID },
      data: {
        operation: 'MIGRATE',
        targetProgramInstanceId: 'wpi_attacker2', targetCycleId: 'cyc_attacker2',
        questionnaireId: 'q1', questionnaireVersion: 1,
        targetPrescriptionInputSnapshot: {
          snapshotId: snapshotIdFor('QUESTIONNAIRE_BASELINE', inputs),
          schemaVersion: 1, source: 'QUESTIONNAIRE_BASELINE', inputs,
        },
      },
    } as never, db)).rejects.toMatchObject({ code: 'aborted', message: 'lifecycle_already_initialized' });
  });

  it('INITIALIZE seals the three-day conditioning plan with typed interval cycles', async () => {
    const root = db.collection('users').doc(UID);
    await Promise.all([
      root.collection('workoutLifecycleState').doc('current').delete(),
      root.collection('programInstances').doc('wpi_active').delete(),
      root.collection('trainingCycles').doc('cyc_active').delete(),
      root.collection('workoutPrograms').doc('wpg_active').delete(),
    ]);
    const inputs = completeInputs({
      goal: 'conditioning', level: 'intermediate', days: 3,
      trainingDays: ['MON', 'WED', 'FRI'], duration: '60',
    });
    await root.collection('questionnaires').doc('q_conditioning').set({ answers: inputs, version: 1 });

    const result = await authorizeWorkoutLifecycleMutationHandler({
      auth: { uid: UID },
      data: {
        operation: 'INITIALIZE',
        targetProgramInstanceId: 'wpi_conditioning', targetCycleId: 'cyc_conditioning',
        questionnaireId: 'q_conditioning', questionnaireVersion: 1,
        targetProgramSource: 'automatic_reconciliation',
        targetPrescriptionInputSnapshot: {
          snapshotId: snapshotIdFor('QUESTIONNAIRE_BASELINE', inputs),
          schemaVersion: 1, source: 'QUESTIONNAIRE_BASELINE', inputs,
        },
      },
    } as never, db);

    expect(result.canonical?.targetPlan.templateId).toBe('T050');
    const intervalBike = result.canonical?.targetPlan.sessions
      .flatMap((session) => session.exercises)
      .find((exercise) => exercise.exerciseId === 'stationary-bike' && exercise.cycles != null);
    expect(intervalBike).toMatchObject({ cycles: 8 });
    expect(intervalBike?.sets).toBeUndefined();
    const sealed = await root.collection('workoutPrograms').doc(result.canonical!.targetContentIdentity).get();
    expect(sealed.exists).toBe(true);
  });

  /**
   * Fase 15 — `initializeWorkoutProgramV127Handler`'s own doc comment has
   * the full architecture rationale (the client-transaction write a real
   * v1.27 document requires exceeds Firestore Rules' expression ceiling;
   * see `firestore-tests/workoutPrograms.rules.test.ts`'s Fase 14/15
   * history). These tests prove the ONE-CALL backend-authoritative
   * replacement end to end against the real Firestore Emulator, reusing
   * this file's existing `seedRealPrescriptionCatalog`/`UID`/`completeInputs`
   * fixtures — never a second, parallel test harness.
   */
  describe('initializeWorkoutProgramV127Handler — Fase 15 backend-authoritative v1.27 INITIALIZE', () => {
    beforeEach(async () => {
      // The outer beforeEach seeds a full V2 lifecycle for UID by default
      // (this file's own convention) — a genuine INITIALIZE requires none
      // of that to exist yet, exactly like the "INITIALIZE seals..." test
      // above already does for the v2 handler.
      const root = db.collection('users').doc(UID);
      await Promise.all([
        root.collection('workoutLifecycleState').doc('current').delete(),
        root.collection('programInstances').doc('wpi_active').delete(),
        root.collection('trainingCycles').doc('cyc_active').delete(),
        root.collection('workoutPrograms').doc('wpg_active').delete(),
        root.collection('workoutProgramState').doc('active').delete(),
      ]);
    });

    async function seedQuestionnaire(id: string, overrides: Record<string, unknown> = {}) {
      const inputs = completeInputs({ level: 'intermediate', days: 2, place: 'gym', ...overrides });
      await db.collection('users').doc(UID).collection('questionnaires').doc(id).set({ answers: inputs, version: 1 });
      return inputs;
    }

    it('installs all five T004 sessions while discarding historical physical answers', async () => {
      await seedQuestionnaire('q_old_physical', { sex: 'm', goal: 'gain_muscle', level: 'intermediate', days: 5, place: 'gym', specialConditions: ['musculoskeletal_limitation'], limits: ['knee', 'back', 'other'] });
      const result = await initializeWorkoutProgramV127Handler({ auth: { uid: UID }, data: { questionnaireId: 'q_old_physical', questionnaireVersion: 1 } } as never, db);
      const root = db.collection('users').doc(UID);
      const program = (await root.collection('workoutPrograms').doc(result.programId).get()).data()!;
      expect(program.templateId).toBe('T004');
      expect(program.sessions).toHaveLength(5);
      expect(program.sessions[2].exercises.some((item: { exerciseId: string }) => item.exerciseId === 'leg-press-45')).toBe(true);
      expect(program.sessions[4].exercises.length).toBeGreaterThan(0);
      expect(JSON.stringify(program)).not.toMatch(/limitation|musculoskeletal|substitutionPolicy/);
      const instance = (await root.collection('programInstances').doc(result.programInstanceId).get()).data()!;
      expect(instance.prescriptionInputSnapshot.inputs).not.toHaveProperty('limits');
      expect(instance.prescriptionInputSnapshot.inputs.specialConditions).not.toContain('musculoskeletal_limitation');
    });

    it('generates, safety-validates, and persists a real v1.27 plan entirely server-side — no client transaction involved', async () => {
      await seedQuestionnaire('q_v127_init');
      const result = await initializeWorkoutProgramV127Handler(
        { auth: { uid: UID }, data: { questionnaireId: 'q_v127_init', questionnaireVersion: 1 } } as never, db,
      );
      expect(result).toMatchObject({ status: 'SUCCESS' });
      expect(result.programId).toMatch(/^wpg_/);
      expect(result.programInstanceId).toMatch(/^wpi_/);

      const root = db.collection('users').doc(UID);
      const [program, lifecycle, state, instance] = await Promise.all([
        root.collection('workoutPrograms').doc(result.programId).get(),
        root.collection('workoutLifecycleState').doc('current').get(),
        root.collection('workoutProgramState').doc('active').get(),
        root.collection('programInstances').doc(result.programInstanceId).get(),
      ]);
      expect(program.exists).toBe(true);
      const programData = program.data()!;
      // Persisted content matches the authoritative generation exactly —
      // real T001-T102 template, real v1.27 versions block, real non-empty
      // sessions/trace, never a placeholder.
      expect(programData.versions).toMatchObject({
        templateLibrary: '1.27.0', compositionEngine: '3.0.0', selectionEngine: '3.0.0',
      });
      expect(/^T(?:00[1-9]|0[1-9][0-9]|10[0-2])$/.test(programData.templateId)).toBe(true);
      expect(Array.isArray(programData.sessions) && programData.sessions.length > 0).toBe(true);
      expect(programData.trace?.safety?.status).toMatch(/^(CLEAR|ADAPTED)$/);
      expect(programData.status).toBe('active');
      expect(programData.source).toBe('onboarding');
      expect(programData.questionnaireId).toBe('q_v127_init');

      expect(lifecycle.exists).toBe(true);
      expect(lifecycle.data()).toMatchObject({
        activeContentIdentity: result.programId,
        activeProgramInstanceId: result.programInstanceId,
        currentCycleNumber: 1,
      });
      expect(state.exists).toBe(true);
      expect(state.data()).toMatchObject({ programId: result.programId, programInstanceId: result.programInstanceId });
      expect(instance.exists).toBe(true);
      expect(instance.data()).toMatchObject({ contentIdentity: result.programId, activationReason: 'INITIAL_PROGRAM' });
      const cycle = await root.collection('trainingCycles').doc(instance.data()!.cycleId).get();
      expect(cycle.exists).toBe(true);
      expect(cycle.data()).toMatchObject({ status: 'ACTIVE', cycleNumber: 1 });
    });

    it('accepts intermediate_experienced (diet-quality-audit-session regression, 2026-10-10) — a brand-new account must not get starting_level_unknown for this normal quiz answer', async () => {
      await seedQuestionnaire('q_v127_intermediate_experienced', { level: 'intermediate_experienced' });
      const result = await initializeWorkoutProgramV127Handler(
        { auth: { uid: UID }, data: { questionnaireId: 'q_v127_intermediate_experienced', questionnaireVersion: 1 } } as never, db,
      );
      expect(result.status).toBe('SUCCESS');
      const lifecycle = await db.collection('users').doc(UID).collection('workoutLifecycleState').doc('current').get();
      expect(lifecycle.data()?.currentTrainingLevel).toBe('INTERMEDIATE');
    });

    it('ignores any client-supplied templateId/versions/trace/sessions/plan — the request shape has no field for them', async () => {
      await seedQuestionnaire('q_v127_forged');
      const forged = {
        questionnaireId: 'q_v127_forged',
        questionnaireVersion: 1,
        // None of these are read by the handler at all — it only destructures
        // `questionnaireId`/`questionnaireVersion` from `request.data`.
        templateId: 'T001',
        targetPlan: { templateId: 'T999', sessions: [], trace: { safety: { status: 'CLEAR' }, unresolvedModifiers: [] } },
        versions: { templateLibrary: '9.9.9' },
        trace: { safety: { status: 'BLOCKED' } },
        sessions: [{ name: 'forged', exercises: [] }],
      };
      const forgedResult = await initializeWorkoutProgramV127Handler(
        { auth: { uid: UID }, data: forged } as never, db,
      );
      const program = await db.collection('users').doc(UID).collection('workoutPrograms').doc(forgedResult.programId).get();
      expect(program.data()?.templateId).not.toBe('T999');
      expect(program.data()?.versions?.templateLibrary).toBe('1.27.0');
      expect(program.data()?.trace?.safety?.status).not.toBe('BLOCKED');
      expect(program.data()?.sessions).not.toEqual([{ name: 'forged', exercises: [] }]);
    });

    it('a retry (double tap / redelivered call) for the same questionnaire converges on the same program instead of creating a second one', async () => {
      await seedQuestionnaire('q_v127_retry');
      const request = { auth: { uid: UID }, data: { questionnaireId: 'q_v127_retry', questionnaireVersion: 1 } } as never;
      const first = await initializeWorkoutProgramV127Handler(request, db);
      const lifecycleAfterFirst = (await db.collection('users').doc(UID)
        .collection('workoutLifecycleState').doc('current').get()).data()!;

      const second = await initializeWorkoutProgramV127Handler(request, db);
      expect(second.programId).toBe(first.programId);
      expect(second.programInstanceId).toBe(first.programInstanceId);

      const lifecycleAfterSecond = (await db.collection('users').doc(UID)
        .collection('workoutLifecycleState').doc('current').get()).data()!;
      // The idempotent retry must not have re-written the lifecycle document
      // at all — same createdAt, proving the second call took the "already
      // initialized with this exact content" fast path, not a second write.
      expect(lifecycleAfterSecond.createdAt).toEqual(lifecycleAfterFirst.createdAt);

      const instances = await db.collection('users').doc(UID).collection('programInstances').get();
      expect(instances.size).toBe(1);
    });

    it('falls back cleanly (workout_lifecycle_v127_initialize_not_applicable) once a real lifecycle already exists, instead of corrupting it', async () => {
      await seedQuestionnaire('q_v127_first');
      await initializeWorkoutProgramV127Handler(
        { auth: { uid: UID }, data: { questionnaireId: 'q_v127_first', questionnaireVersion: 1 } } as never, db,
      );
      await seedQuestionnaire('q_v127_second', { days: 4 });
      await expect(initializeWorkoutProgramV127Handler(
        { auth: { uid: UID }, data: { questionnaireId: 'q_v127_second', questionnaireVersion: 1 } } as never, db,
      )).rejects.toMatchObject({ code: 'failed-precondition', message: 'workout_lifecycle_v127_initialize_not_applicable' });
    });
  });

  /**
   * Fase 17 — legacy `authorizeWorkoutLifecycleMutation` INITIALIZE
   * compatibility. A production app build that predates `initializeWorkoutProgramV127`
   * still calls this callable directly for its first-ever program and, on
   * success, tries to persist `canonical.targetPlan` itself via its own
   * Firestore transaction (`saveAndActivateWorkoutProgram` in
   * `src/services/workoutPrograms.ts`) — a write the v1.27 Rules guard now
   * rejects. These tests prove the fix: the handler persists the whole
   * lifecycle server-side via `persistNewLifecycleV127` (shared with
   * `initializeWorkoutProgramV127Handler`) BEFORE returning, while the
   * response shape itself stays byte-for-byte what old clients already
   * know how to consume (`{grantId, expiresAtMs, canonical}` — never
   * `{persisted}`), so the old client's own subsequent transaction finds
   * `currentId === programId` already and never attempts to write
   * `workoutPrograms` at all.
   */
  describe('authorizeWorkoutLifecycleMutationHandler — Fase 17 legacy INITIALIZE compatibility', () => {
    beforeEach(async () => {
      const root = db.collection('users').doc(UID);
      await Promise.all([
        root.collection('workoutLifecycleState').doc('current').delete(),
        root.collection('programInstances').doc('wpi_active').delete(),
        root.collection('trainingCycles').doc('cyc_active').delete(),
        root.collection('workoutPrograms').doc('wpg_active').delete(),
        root.collection('workoutProgramState').doc('active').delete(),
      ]);
    });

    function legacyInitializeRequest(questionnaireId: string, inputs: Record<string, unknown>) {
      return {
        auth: { uid: UID },
        data: {
          operation: 'INITIALIZE',
          targetProgramInstanceId: 'wpi_legacy_client_guess',
          targetCycleId: 'cyc_legacy_client_guess',
          questionnaireId,
          questionnaireVersion: 1,
          targetProgramSource: 'onboarding',
          targetPrescriptionInputSnapshot: {
            snapshotId: snapshotIdFor('QUESTIONNAIRE_BASELINE', inputs),
            schemaVersion: 1, source: 'QUESTIONNAIRE_BASELINE', inputs,
          },
        },
      } as never;
    }

    it('persists the full v1.27 lifecycle server-side and returns the unchanged grant+canonical shape (never `persisted`)', async () => {
      const inputs = completeInputs({ level: 'intermediate', days: 2, place: 'gym' });
      await db.collection('users').doc(UID).collection('questionnaires').doc('q_legacy_init').set({ answers: inputs, version: 1 });

      const result = await authorizeWorkoutLifecycleMutationHandler(legacyInitializeRequest('q_legacy_init', inputs), db);

      expect(result.grantId).toBe('current');
      expect(typeof result.expiresAtMs).toBe('number');
      expect(result.canonical?.targetPlan.versions).toMatchObject({ templateLibrary: '1.27.0' });
      expect((result as { persisted?: unknown }).persisted).toBeUndefined();

      const targetContentIdentity = result.canonical!.targetContentIdentity;
      const root = db.collection('users').doc(UID);
      const [program, lifecycle, state] = await Promise.all([
        root.collection('workoutPrograms').doc(targetContentIdentity).get(),
        root.collection('workoutLifecycleState').doc('current').get(),
        root.collection('workoutProgramState').doc('active').get(),
      ]);
      expect(program.exists).toBe(true);
      expect(lifecycle.exists).toBe(true);
      expect(lifecycle.data()).toMatchObject({ activeContentIdentity: targetContentIdentity });
      // Proves the legacy client compatibility mechanism itself: by the time
      // the old client's own `saveAndActivateWorkoutProgram` transaction
      // re-reads `workoutProgramState/active`, `currentId` already equals
      // the `programId` it would have overridden itself to — its own
      // `if (currentId !== programId)` branch (the one that would attempt a
      // direct `workoutPrograms` write the v1.27 Rules guard rejects) is
      // unreachable.
      expect(state.exists).toBe(true);
      expect(state.data()).toMatchObject({ programId: targetContentIdentity });
      const instanceId = lifecycle.data()!.activeProgramInstanceId as string;
      const instance = await root.collection('programInstances').doc(instanceId).get();
      expect(instance.exists).toBe(true);
      expect(instance.data()).toMatchObject({ contentIdentity: targetContentIdentity, activationReason: 'INITIAL_PROGRAM' });
    });

    it('a repeat legacy INITIALIZE call once state already exists is rejected exactly as before this fix — the legacy protocol was never idempotent at this layer, only the caller (its own preflight resolves a second call to MIGRATE, not a repeated INITIALIZE)', async () => {
      const inputs = completeInputs({ level: 'beginner', days: 3, place: 'home', equipment: ['bodyweight'] });
      await db.collection('users').doc(UID).collection('questionnaires').doc('q_legacy_repeat').set({ answers: inputs, version: 1 });
      const request = legacyInitializeRequest('q_legacy_repeat', inputs);

      await authorizeWorkoutLifecycleMutationHandler(request, db);
      await expect(authorizeWorkoutLifecycleMutationHandler(request, db))
        .rejects.toMatchObject({ code: 'aborted', message: 'lifecycle_already_initialized' });
      const instances = await db.collection('users').doc(UID).collection('programInstances').get();
      expect(instances.size).toBe(1);
    });

    it('the dedicated new-client callable (initializeWorkoutProgramV127Handler) still works after sharing its persist logic with the legacy path', async () => {
      const inputs = completeInputs({ level: 'advanced', days: 5, place: 'gym' });
      await db.collection('users').doc(UID).collection('questionnaires').doc('q_new_client').set({ answers: inputs, version: 1 });

      const result = await initializeWorkoutProgramV127Handler(
        { auth: { uid: UID }, data: { questionnaireId: 'q_new_client', questionnaireVersion: 1 } } as never, db,
      );
      expect(result).toMatchObject({ status: 'SUCCESS' });
      const lifecycle = await db.collection('users').doc(UID).collection('workoutLifecycleState').doc('current').get();
      expect(lifecycle.data()).toMatchObject({ activeContentIdentity: result.programId, activeProgramInstanceId: result.programInstanceId });
    });

    it('an existing V2 lifecycle keeps rejecting INITIALIZE (and ADAPT keeps preserving v2) — this fix never touches non-INITIALIZE operations', async () => {
      // Restore the outer beforeEach's default V2-active seed this inner
      // beforeEach just deleted, then prove INITIALIZE is still refused
      // exactly like before this fix (Fase 17 only adds a persist side
      // effect INSIDE the INITIALIZE branch — it never changes when that
      // branch is reached).
      const root = db.collection('users').doc(UID);
      await Promise.all([
        root.collection('workoutLifecycleState').doc('current').set({
          currentTrainingLevel: 'BEGINNER', currentCycleId: 'cyc_active', currentCycleNumber: 1,
          activeProgramInstanceId: 'wpi_active', activeContentIdentity: 'wpg_active',
          activePrescriptionIdentity: 'rx_active',
        }),
        root.collection('workoutProgramState').doc('active').set({ programId: 'wpg_active', programInstanceId: 'wpi_active' }),
      ]);
      const inputs = completeInputs();
      await expect(authorizeWorkoutLifecycleMutationHandler({
        auth: { uid: UID },
        data: {
          operation: 'INITIALIZE',
          targetProgramInstanceId: 'wpi_attacker3', targetCycleId: 'cyc_attacker3',
          questionnaireId: 'q1', questionnaireVersion: 1,
          targetPrescriptionInputSnapshot: {
            snapshotId: snapshotIdFor('QUESTIONNAIRE_BASELINE', inputs),
            schemaVersion: 1, source: 'QUESTIONNAIRE_BASELINE', inputs,
          },
        },
      } as never, db)).rejects.toMatchObject({ code: 'aborted', message: 'lifecycle_already_initialized' });
    });
  });

  /**
   * Fase 16 — ADAPT/ACTIVATE's counterpart to Fase 15's INITIALIZE suite
   * above: proves `persistLifecycleActivationV127` (`authorizeMutation.ts`'s
   * own doc comment has the full rationale) end to end against the real
   * Firestore Emulator — the client's own transaction, which a real v1.27
   * document's expression cost breaks, is never reached for these two
   * operations once an active v1.27 program exists.
   */
  describe('persistLifecycleActivationV127 — Fase 16 backend-authoritative v1.27 ADAPT/ACTIVATE', () => {
    beforeEach(async () => {
      const root = db.collection('users').doc(UID);
      await Promise.all([
        root.collection('workoutLifecycleState').doc('current').delete(),
        root.collection('programInstances').doc('wpi_active').delete(),
        root.collection('trainingCycles').doc('cyc_active').delete(),
        root.collection('workoutPrograms').doc('wpg_active').delete(),
        root.collection('workoutProgramState').doc('active').delete(),
      ]);
    });

    const BASE_ADAPT_ANSWERS = completeInputs({ level: 'intermediate', days: 2, place: 'gym' });

    async function seedActiveV127Program(questionnaireId: string, answers = BASE_ADAPT_ANSWERS) {
      await db.collection('users').doc(UID).collection('questionnaires').doc(questionnaireId).set({ answers, version: 1 });
      const init = await initializeWorkoutProgramV127Handler(
        { auth: { uid: UID }, data: { questionnaireId, questionnaireVersion: 1 } } as never, db,
      );
      return init;
    }

    /** Byte-for-byte what `assertSnapshot` (authorizeMutation.ts) itself
     * independently derives for an ADAPT request — `sourceInputs` (the
     * seeded instance's own `prescriptionInputSnapshot.inputs`, built via
     * `effectivePrescriptionInputsFromAnswers` at INITIALIZE time) merged
     * with `updatedFields`, `level` unchanged, `source: 'PROGRAM_ADAPTATION'`. */
    function adaptSnapshotFor(updatedFields: Record<string, unknown>, sourceAnswers = BASE_ADAPT_ANSWERS) {
      // JSON round-tripped to match exactly what `initializeWorkoutProgramV127Handler`
      // actually persisted (it strips `undefined` fields the same way — see
      // that handler's own comment); `assertSnapshot`
      // reads `sourceInputs` straight back off the persisted document.
      const sourceInputs = JSON.parse(JSON.stringify(
        effectivePrescriptionInputsFromAnswers(sourceAnswers as never, 'INTERMEDIATE'),
      )) as Record<string, unknown>;
      const inputs = { ...sourceInputs, ...updatedFields, level: 'intermediate' };
      return {
        snapshotId: snapshotIdFor('PROGRAM_ADAPTATION', inputs),
        schemaVersion: 1, source: 'PROGRAM_ADAPTATION', inputs,
      };
    }

    it('ADAPT persists the full transition via Admin SDK — no grant issued, client transaction never needed', async () => {
      const init = await seedActiveV127Program('q_v127_adapt_base');
      const result = await authorizeWorkoutLifecycleMutationHandler({
        auth: { uid: UID },
        data: {
          operation: 'ADAPT',
          sourceProgramInstanceId: init.programInstanceId,
          targetProgramInstanceId: 'wpi_placeholder', targetCycleId: 'cyc_placeholder',
          targetTrainingLevel: 'INTERMEDIATE', targetCycleNumber: 1,
          questionnaireId: 'q_v127_adapt_base', questionnaireVersion: 1,
          targetProgramSource: 'program_adaptation', eventType: 'PROGRAM_ADAPTED',
          updatedFields: { duration: '45' },
          targetPrescriptionInputSnapshot: adaptSnapshotFor({ duration: '45' }),
        },
      } as never, db);
      // No grant issued — the transition is already fully persisted.
      expect(result).toMatchObject({ persisted: { programId: expect.any(String), programInstanceId: expect.any(String) } });
      expect(result.grantId).toBeUndefined();
      expect((await db.collection('users').doc(UID).collection('workoutLifecycleAuthorityGrants').doc('current').get()).exists).toBe(false);

      const root = db.collection('users').doc(UID);
      const persisted = result.persisted!;
      const [program, lifecycle, oldProgram, oldInstance] = await Promise.all([
        root.collection('workoutPrograms').doc(persisted.programId).get(),
        root.collection('workoutLifecycleState').doc('current').get(),
        root.collection('workoutPrograms').doc(init.programId).get(),
        root.collection('programInstances').doc(init.programInstanceId).get(),
      ]);
      expect(program.exists).toBe(true);
      expect(program.data()?.versions?.templateLibrary).toBe('1.27.0');
      expect(lifecycle.data()).toMatchObject({ activeContentIdentity: persisted.programId, activeProgramInstanceId: persisted.programInstanceId });
      expect(persisted.programInstanceId).not.toBe(init.programInstanceId);
      // The OLD ProgramInstance is always superseded — a new instance is
      // always installed for ADAPT, regardless of content identity.
      expect(oldInstance.data()?.supersededAt).not.toBeNull();
      // The OLD workoutPrograms doc is only superseded (status flip) when
      // ADAPT's content genuinely differs from the prior active content —
      // an Admin SDK write, unaffected by that document's own real size.
      if (persisted.programId !== init.programId) {
        expect(oldProgram.data()?.status).toBe('superseded');
      }
    });

    it('fixed 5→4 commits T003, lifecycle, pending invalidation and calendar atomically; incomplete metadata writes nothing', async () => {
      const root = db.collection('users').doc(UID);
      const fiveDays = ['MON', 'TUE', 'THU', 'FRI', 'SAT'];
      const fourDays: Array<'MON' | 'TUE' | 'THU' | 'FRI'> = ['MON', 'TUE', 'THU', 'FRI'];
      const fiveAnswers = completeInputs({ level: 'intermediate', days: 5, trainingDays: fiveDays, place: 'gym' });
      const init = await seedActiveV127Program('q_v127_fixed_frequency', fiveAnswers);
      expect((await root.collection('workoutPrograms').doc(init.programId).get()).data())
        .toMatchObject({ templateId: 'T004', prescribedTrainingFrequency: 5 });
      expect((await root.collection('workoutPrograms').doc(init.programId).get()).data()?.sessions).toHaveLength(5);
      await root.collection('workoutProgramState').doc('scheduleConfig').set({
        scheduleMode: 'fixed', trainingDays: fiveDays, timezone: 'America/Sao_Paulo', scheduleVersion: 1,
      });
      await root.collection('pendingEvolutions').doc('current').set({ type: 'CYCLE_EVOLUTION' });
      await root.collection('workoutExecutions').doc('historical').set({ programInstanceId: init.programInstanceId, status: 'COMPLETED' });
      await root.collection('workoutPrograms').doc(init.programId).collection('scheduleState')
        .doc(init.programInstanceId).set({
          programId: init.programId, programInstanceId: init.programInstanceId,
          nextSessionIndex: 1, cursorDate: '2026-10-05', lastCompletedAt: '2026-10-05', pendingMissDecision: null,
        });
      const updatedFields = { days: 4, scheduleMode: 'fixed', trainingDays: fourDays };
      const data = {
        operation: 'ADAPT', sourceProgramInstanceId: init.programInstanceId,
        targetProgramInstanceId: 'wpi_placeholder', targetCycleId: 'cyc_placeholder',
        targetTrainingLevel: 'INTERMEDIATE', targetCycleNumber: 1,
        questionnaireId: 'q_v127_fixed_frequency', questionnaireVersion: 1,
        targetProgramSource: 'program_adaptation', eventType: 'PROGRAM_ADAPTED',
        updatedFields, targetPrescriptionInputSnapshot: adaptSnapshotFor(updatedFields, fiveAnswers),
      };
      await expect(authorizeWorkoutLifecycleMutationHandler({
        auth: { uid: UID }, data: { ...data, eventType: undefined },
      } as never, db)).rejects.toMatchObject({ code: 'invalid-argument', message: 'adaptation_event_type_required' });
      expect((await root.collection('workoutPrograms').get()).size).toBe(1);
      expect((await root.collection('programInstances').get()).size).toBe(1);
      expect((await root.collection('workoutProgramState').doc('scheduleConfig').get()).data()?.trainingDays).toEqual(fiveDays);

      const inconsistentFields = { days: 4, scheduleMode: 'fixed', trainingDays: fiveDays };
      await expect(authorizeWorkoutLifecycleMutationHandler({
        auth: { uid: UID }, data: {
          ...data, updatedFields: inconsistentFields,
          targetPrescriptionInputSnapshot: adaptSnapshotFor(inconsistentFields, fiveAnswers),
        },
      } as never, db)).rejects.toMatchObject({
        code: 'invalid-argument', message: 'adaptation_frequency_schedule_inconsistent',
      });
      expect((await root.collection('workoutPrograms').get()).size).toBe(1);
      expect((await root.collection('programInstances').get()).size).toBe(1);
      expect((await root.collection('workoutProgramState').doc('scheduleConfig').get()).data()?.trainingDays).toEqual(fiveDays);

      const result = await authorizeWorkoutLifecycleMutationHandler({ auth: { uid: UID }, data } as never, db);
      const [program, oldInstance, active, config, pending, history] = await Promise.all([
        root.collection('workoutPrograms').doc(result.persisted!.programId).get(),
        root.collection('programInstances').doc(init.programInstanceId).get(),
        root.collection('workoutLifecycleState').doc('current').get(),
        root.collection('workoutProgramState').doc('scheduleConfig').get(),
        root.collection('pendingEvolutions').doc('current').get(),
        root.collection('workoutExecutions').doc('historical').get(),
      ]);
      expect(program.data()).toMatchObject({ templateId: 'T003', prescribedTrainingFrequency: 4 });
      expect(program.data()?.weeklySchedule.filter((day: { state: string }) => day.state === 'TRAINING')).toHaveLength(4);
      expect(active.data()?.activeProgramInstanceId).toBe(result.persisted!.programInstanceId);
      expect(oldInstance.data()?.supersededAt).not.toBeNull();
      expect(config.data()).toMatchObject({ scheduleMode: 'fixed', trainingDays: fourDays, timezone: 'America/Sao_Paulo' });
      expect(pending.exists).toBe(false);
      expect(history.exists).toBe(true);
      expect((await root.collection('workoutPrograms').doc(init.programId).collection('scheduleState')
        .doc(init.programInstanceId).get()).data()?.nextSessionIndex).toBe(1);
      expect((await root.collection('programInstances').get()).size).toBe(2);
      expect((await root.collection('workoutLifecycleEvents').where('type', '==', 'PROGRAM_ADAPTED').get()).size).toBe(1);
      // The new instance intentionally has no persisted cursor until its
      // first completion; the resolver must still offer a real first session.
      expect((await root.collection('workoutPrograms').doc(result.persisted!.programId)
        .collection('scheduleState').doc(result.persisted!.programInstanceId).get()).exists).toBe(false);
      expect(resolveWorkoutSchedule({
        hasActiveProgram: true, sessionCount: program.data()!.sessions.length,
        config: { scheduleMode: 'fixed', trainingDays: fourDays, timezone: 'America/Sao_Paulo', scheduleVersion: 1 },
        state: null, activatedAtLocalDate: '2026-10-05', todayLocalDate: '2026-10-05',
      })).toMatchObject({ status: 'SESSION_READY' });
    });

    it('two concurrent identical ADAPT calls (double tap) converge on one transition, never two', async () => {
      const init = await seedActiveV127Program('q_v127_adapt_retry');
      const requestData = {
        operation: 'ADAPT',
        sourceProgramInstanceId: init.programInstanceId,
        targetProgramInstanceId: 'wpi_placeholder', targetCycleId: 'cyc_placeholder',
        targetTrainingLevel: 'INTERMEDIATE', targetCycleNumber: 1,
        questionnaireId: 'q_v127_adapt_retry', questionnaireVersion: 1,
        targetProgramSource: 'program_adaptation', eventType: 'PROGRAM_ADAPTED',
        updatedFields: { duration: '45' },
        targetPrescriptionInputSnapshot: adaptSnapshotFor({ duration: '45' }),
      };
      // Both calls read the SAME pre-ADAPT source snapshot (the real double-
      // tap/redelivery shape) — a genuinely SEQUENTIAL retry after the first
      // call already succeeded would instead see the now-updated active
      // instance and correctly fail `stale_lifecycle_authority_base`
      // (`assertSource`) — that is the real, intentional staleness guard,
      // not the scenario this idempotency test targets.
      const [first, second] = await Promise.all([
        authorizeWorkoutLifecycleMutationHandler({ auth: { uid: UID }, data: requestData } as never, db),
        authorizeWorkoutLifecycleMutationHandler({ auth: { uid: UID }, data: requestData } as never, db),
      ]);
      expect(second.persisted).toEqual(first.persisted);
      const instances = await db.collection('users').doc(UID).collection('programInstances').get();
      // Exactly two: the seeded baseline + the one ADAPT transition (not a
      // second one from the retry).
      expect(instances.size).toBe(2);
    });

    it('v2 ADAPT is completely unaffected — still returns a grant, never the persisted shape', async () => {
      const root = db.collection('users').doc(UID);
      await Promise.all([
        root.collection('workoutLifecycleState').doc('current').set({
          currentTrainingLevel: 'BEGINNER', currentCycleId: 'cyc_active', currentCycleNumber: 1,
          activeProgramInstanceId: 'wpi_active', activeContentIdentity: 'wpg_active',
          activePrescriptionIdentity: 'rx_active',
        }),
        root.collection('programInstances').doc('wpi_active').set({
          programInstanceId: 'wpi_active', cycleId: 'cyc_active', contentIdentity: 'wpg_active',
          prescriptionIdentity: 'rx_active', activatedAt: Timestamp.fromMillis(Date.now() - 86_400_000),
          prescriptionInputSnapshot: {
            snapshotId: 'pis_active', schemaVersion: 1, source: 'QUESTIONNAIRE_BASELINE',
            inputs: JSON.parse(JSON.stringify(
              effectivePrescriptionInputsFromAnswers(completeInputs({ level: 'beginner', days: 4 }) as never, 'BEGINNER'),
            )),
          },
        }),
        root.collection('trainingCycles').doc('cyc_active').set({
          cycleId: 'cyc_active', level: 'BEGINNER', cycleNumber: 1, status: 'ACTIVE', programInstanceId: 'wpi_active',
        }),
        root.collection('workoutPrograms').doc('wpg_active').set({
          programId: 'wpg_active', prescriptionId: 'rx_active', versions: { templateLibrary: '2.0.0' },
          sessions: [{ name: 'Full body', exercises: [{ exerciseId: 'squat', sets: 3 }] }],
        }),
      ]);
      const result = await authorizeWorkoutLifecycleMutationHandler({
        auth: { uid: UID },
        data: {
          operation: 'ADAPT', sourceProgramInstanceId: 'wpi_active', sourceCycleId: 'cyc_active',
          targetProgramInstanceId: 'wpi_placeholder', targetCycleId: 'cyc_active',
          questionnaireId: 'q1', questionnaireVersion: 1,
          targetProgramSource: 'program_adaptation', updatedFields: { duration: '45' },
          targetPrescriptionInputSnapshot: (() => {
            const sourceInputs = JSON.parse(JSON.stringify(
              effectivePrescriptionInputsFromAnswers(completeInputs({ level: 'beginner', days: 4 }) as never, 'BEGINNER'),
            )) as Record<string, unknown>;
            const inputs = { ...sourceInputs, duration: '45', level: 'beginner' };
            return { snapshotId: snapshotIdFor('PROGRAM_ADAPTATION', inputs), schemaVersion: 1, source: 'PROGRAM_ADAPTATION', inputs };
          })(),
        },
      } as never, db);
      expect(result.persisted).toBeUndefined();
      expect(result.grantId).toBe('current');
    });
  });

  describe('MIGRATE — bootstrap canonical authority for V1→V2 baseline', () => {
    beforeEach(async () => {
      const root = db.collection('users').doc(UID);
      await Promise.all([
        root.collection('workoutLifecycleState').doc('current').delete(),
        root.collection('programInstances').doc('wpi_active').delete(),
        root.collection('trainingCycles').doc('cyc_active').delete(),
        root.collection('workoutPrograms').doc('wpg_active').delete(),
        root.collection('questionnaires').doc('q1').set({ answers: completeInputs(), version: 1 }),
      ]);
    });

    function migrateRequest(overrides: Record<string, unknown> = {}) {
      const inputs = completeInputs();
      return {
        operation: 'MIGRATE',
        targetProgramInstanceId: 'wpi_bootstrap', targetCycleId: 'cyc_bootstrap',
        questionnaireId: 'q1', questionnaireVersion: 1,
        targetProgramSource: 'automatic_reconciliation',
        targetTemplateVersion: 1, targetTemplateSourceVersion: '1.0.0', targetTemplateContentHash: 'seed',
        targetPrescriptionInputSnapshot: {
          snapshotId: snapshotIdFor('QUESTIONNAIRE_BASELINE', inputs),
          schemaVersion: 1, source: 'QUESTIONNAIRE_BASELINE', inputs,
        },
        ...overrides,
      };
    }

    // C8 — a V1 active-pointer race: `workoutProgramState/active` references
    // a program that does not exist (or is missing `prescriptionId`) by the
    // time MIGRATE actually reads it. Must fail closed, not silently invent
    // a baseline from nothing.
    it('fails closed when the V1 active pointer references a program that does not exist (raced/forged pointer)', async () => {
      await db.collection('users').doc(UID).collection('workoutProgramState').doc('active').set({ programId: 'wpg_ghost' });
      await expect(authorizeWorkoutLifecycleMutationHandler({
        auth: { uid: UID }, data: migrateRequest(),
      } as never, db)).rejects.toMatchObject({ code: 'failed-precondition', message: 'legacy_baseline_program_missing' });
    });

    // C1/C2/C3 — safe-but-wrong candidate + attacker-chosen identities. The
    // client's `targetPlan`/`targetContentIdentity`/`targetPrescriptionIdentity`
    // are never read as content authority for MIGRATE, identically to
    // INITIALIZE/ADAPT — the backend regenerates the canonical plan from the
    // authoritative questionnaire answers and derives its own identities.
    it('a safe-but-wrong client targetPlan and attacker-chosen identities never become the sealed baseline — backend canonical always wins', async () => {
      await db.collection('users').doc(UID).collection('workoutProgramState').doc('active').set({ programId: 'wpg_legacy_v1' });
      await db.collection('users').doc(UID).collection('workoutPrograms').doc('wpg_legacy_v1').set({
        programId: 'wpg_legacy_v1', prescriptionId: 'rx_legacy_v1',
        sessions: [{ name: 'Legacy', exercises: [{ exerciseId: 'squat', sets: 3 }] }],
      });
      const result = await authorizeWorkoutLifecycleMutationHandler({
        auth: { uid: UID },
        data: migrateRequest({
          targetContentIdentity: 'wpg_attacker', targetPrescriptionIdentity: 'rx_attacker',
          targetPlan: {
            planId: 'rx_attacker',
            sessions: [{ exercises: [{ exerciseId: 'lat-pulldown', sets: 1_000_000 }] }],
          },
        }),
      } as never, db);
      expect(result).toMatchObject({ grantId: 'current' });
      // The attacker's claimed identity was never sealed at all.
      expect((await db.collection('users').doc(UID)
        .collection('workoutPrograms').doc('wpg_attacker').get()).exists).toBe(false);
      expect(result.canonical?.targetContentIdentity).not.toBe('wpg_attacker');
      expect(result.canonical?.targetPrescriptionIdentity).not.toBe('rx_attacker');
      const grant = (await db.collection('users').doc(UID)
        .collection('workoutLifecycleAuthorityGrants').doc('current').get()).data();
      // The legacy baseline being superseded is independently re-derived
      // from the real (pre-existing, backend-read) V1 pointer — never from
      // anything the client claims.
      expect(grant?.baselineContentIdentity).toBe('wpg_legacy_v1');
      expect(grant?.baselinePrescriptionIdentity).toBe('rx_legacy_v1');
      const sealed = await db.collection('users').doc(UID)
        .collection('workoutPrograms').doc(grant!.targetContentIdentity as string).get();
      const sets = (sealed.data()!.sessions as Array<{ exercises: Array<{ sets?: number }> }>)
        .flatMap((session) => session.exercises.map((item) => item.sets));
      expect(sets.length).toBeGreaterThan(0);
      for (const setCount of sets) {
        expect(setCount ?? 1).toBeLessThanOrEqual(10);
      }
    });

    // C4/idempotency at the content-generation layer (distinct from the
    // state.exists guard above, which blocks a SECOND migration attempt once
    // V2 exists): two concurrent first-ever MIGRATE calls for the same
    // account, racing before either has created `workoutLifecycleState`,
    // must never seal two different "baseline" programs under two different
    // identities — deterministic canonical generation from the same
    // authoritative questionnaire answers means both calls compute the
    // IDENTICAL content identity, and `sealTargetProgram`'s transaction
    // converges them onto one document.
    it('concurrent first-ever MIGRATE calls converge on one sealed baseline, never two', async () => {
      await db.collection('users').doc(UID).collection('workoutProgramState').doc('active').set({ programId: 'wpg_legacy_v1' });
      await db.collection('users').doc(UID).collection('workoutPrograms').doc('wpg_legacy_v1').set({
        programId: 'wpg_legacy_v1', prescriptionId: 'rx_legacy_v1',
        sessions: [{ name: 'Legacy', exercises: [{ exerciseId: 'squat', sets: 3 }] }],
      });
      const [a, b] = await Promise.all([
        authorizeWorkoutLifecycleMutationHandler({ auth: { uid: UID }, data: migrateRequest() } as never, db),
        authorizeWorkoutLifecycleMutationHandler({ auth: { uid: UID }, data: migrateRequest() } as never, db),
      ]);
      expect(a.canonical?.targetContentIdentity).toBe(b.canonical?.targetContentIdentity);
      expect(a.canonical?.targetPrescriptionIdentity).toBe(b.canonical?.targetPrescriptionIdentity);
      // Exactly one NEW program document was created beyond the pre-seeded
      // legacy one — never two different "baseline" identities.
      const allPrograms = await db.collection('users').doc(UID).collection('workoutPrograms').get();
      const nonLegacy = allPrograms.docs.filter((item) => item.id !== 'wpg_legacy_v1');
      expect(nonLegacy).toHaveLength(1);
    });
  });

  // Phase 10B (docs/workout-lifecycle/v2/decisions/
  // ADR-016_BACKEND_AUTHORITATIVE_PRESCRIPTION.md) — the exact reproduced
  // exploit: a structurally plausible ADAPT plan with a semantically
  // impossible exercise (1,000,000 sets). Since the backend now generates
  // its own canonical plan and never reads the client's `targetPlan` for
  // content, the operation succeeds — but the SEALED content must be the
  // backend's own reasonable plan, never the attacker's absurd one.
  it('never seals a client-submitted 1,000,000-set exercise — the backend always seals its own canonical plan instead', async () => {
    const inputs = completeInputs();
    await db.collection('users').doc(UID).collection('programInstances').doc('wpi_active').update({
      prescriptionInputSnapshot: {
        snapshotId: 'pis_active', schemaVersion: 1, source: 'QUESTIONNAIRE_BASELINE', inputs,
      },
    });
    const result = await authorizeWorkoutLifecycleMutationHandler({
      auth: { uid: UID },
      data: {
        operation: 'ADAPT', targetProgramSource: 'program_adaptation', eventType: 'PROGRAM_ADAPTED',
        questionnaireId: 'q1', questionnaireVersion: 1,
        sourceProgramInstanceId: 'wpi_active', sourceCycleId: 'cyc_active',
        sourcePrescriptionInputSnapshotId: 'pis_active', targetProgramInstanceId: 'wpi_attacker',
        targetContentIdentity: 'wpg_attacker', targetPrescriptionIdentity: 'rx_attacker',
        targetTrainingLevel: 'BEGINNER', targetCycleNumber: 1,
        updatedFields: {}, targetPlan: {
          planId: 'rx_attacker', sessions: [{ exercises: [{ exerciseId: 'lat-pulldown', sets: 1_000_000 }] }],
        },
        targetPrescriptionInputSnapshot: {
          snapshotId: snapshotIdFor('PROGRAM_ADAPTATION', inputs),
          schemaVersion: 1, source: 'PROGRAM_ADAPTATION', inputs,
        },
      },
    } as never, db);
    expect(result).toMatchObject({ grantId: 'current' });
    // The attacker's claimed identity was never sealed at all.
    expect((await db.collection('users').doc(UID)
      .collection('workoutPrograms').doc('wpg_attacker').get()).exists).toBe(false);
    const grant = (await db.collection('users').doc(UID)
      .collection('workoutLifecycleAuthorityGrants').doc('current').get()).data();
    expect(result.canonical?.targetContentIdentity).toMatch(/^wpg_[0-9a-f]{8}$/);
    expect(result.canonical?.targetContentIdentity).toBe(grant?.targetContentIdentity);
    expect(result.canonical?.targetContentIdentity).not.toBe(result.canonical?.targetPrescriptionIdentity);
    const sealed = await db.collection('users').doc(UID)
      .collection('workoutPrograms').doc(grant!.targetContentIdentity as string).get();
    expect(sealed.data()).toMatchObject({
      programId: result.canonical?.targetContentIdentity,
      prescriptionId: result.canonical?.targetPrescriptionIdentity,
    });
    const sets = (sealed.data()!.sessions as Array<{ exercises: Array<{ sets?: number }> }>)
      .flatMap((session) => session.exercises.map((item) => item.sets));
    expect(sets.length).toBeGreaterThan(0);
    for (const setCount of sets) {
      expect(setCount ?? 1).toBeLessThanOrEqual(10);
    }
  });

  // Phase 10D closure of P0-1 (docs/workout-lifecycle/v2/architecture/
  // 22_POST_PHASE_10C_FINAL_ADVERSARIAL_AUDIT.md Finding PA-RECOVER-01;
  // docs/workout-lifecycle/v2/architecture/
  // 23_PHASE_10D_FINAL_AUTHORITY_BYPASS_REMEDIATION.md): RECOVER is
  // identity/state reconciliation ONLY. Phase 10B's "bounds-check any
  // carried plan" compromise still let RECOVER become a canonical-authority
  // bypass — a schema-valid, in-bounds, real-exercise "safe-but-wrong" plan
  // sailed through `assertPlanSafe` and rode the grant to becoming
  // authoritative. Phase 10D removes the compromise: ANY `targetPlan` on a
  // RECOVER request is rejected outright, unconditionally, before any grant
  // is issued — there is no bounds-checked content path here anymore.
  it('RECOVER rejects a fully safe-but-wrong targetPlan outright (no bounds-checked content path)', async () => {
    await expect(authorizeWorkoutLifecycleMutationHandler({
      auth: { uid: UID },
      data: {
        operation: 'RECOVER', sourceProgramInstanceId: 'wpi_active', sourceCycleId: 'cyc_active',
        targetProgramInstanceId: 'wpi_active', targetCycleId: 'cyc_active',
        // Deliberately NOT absurd — schema-valid, in-bounds, plausible.
        targetContentIdentity: 'wpg_attacker_chosen',
        targetPlan: {
          planId: 'rx_recover_attack',
          sessions: [{ exercises: [{ exerciseId: 'lat-pulldown', sets: 3, reps: '10-12', restSeconds: 90 }] }],
        },
        targetPrescriptionInputSnapshot: {
          snapshotId: 'pis_active', schemaVersion: 1, source: 'QUESTIONNAIRE_BASELINE', inputs: completeInputs(),
        },
      },
    } as never, db)).rejects.toMatchObject({ code: 'permission-denied', message: 'recover_does_not_install_content' });
    expect((await db.collection('users').doc(UID)
      .collection('workoutLifecycleAuthorityGrants').doc('current').get()).exists).toBe(false);
  });

  it('RECOVER still rejects a bounds-violating targetPlan outright (same denial, not a bounds error)', async () => {
    await expect(authorizeWorkoutLifecycleMutationHandler({
      auth: { uid: UID },
      data: {
        operation: 'RECOVER', sourceProgramInstanceId: 'wpi_active', sourceCycleId: 'cyc_active',
        targetProgramInstanceId: 'wpi_active', targetCycleId: 'cyc_active',
        targetPlan: {
          planId: 'rx_recover_attack',
          sessions: [{ exercises: [{ exerciseId: 'lat-pulldown', sets: 1_000_000 }] }],
        },
        targetPrescriptionInputSnapshot: {
          snapshotId: 'pis_active', schemaVersion: 1, source: 'QUESTIONNAIRE_BASELINE', inputs: completeInputs(),
        },
      },
    } as never, db)).rejects.toMatchObject({ code: 'permission-denied', message: 'recover_does_not_install_content' });
    expect((await db.collection('users').doc(UID)
      .collection('workoutLifecycleAuthorityGrants').doc('current').get()).exists).toBe(false);
  });

  it('RECOVER still succeeds without any targetPlan (pure identity/state reconciliation)', async () => {
    await expect(authorizeWorkoutLifecycleMutationHandler({
      auth: { uid: UID },
      data: {
        operation: 'RECOVER', sourceProgramInstanceId: 'wpi_active', sourceCycleId: 'cyc_active',
      },
    } as never, db)).resolves.toMatchObject({ grantId: 'current' });
  });

  // Phase 10D — RECOVER identity attack (docs/workout-lifecycle/v2/
  // architecture/22_POST_PHASE_10C_FINAL_ADVERSARIAL_AUDIT.md §8/§16): even
  // with no `targetPlan`, none of RECOVER's identity fields may be taken
  // from the client — a client-chosen `targetContentIdentity`/
  // `targetPrescriptionIdentity` must never survive into the grant.
  it('RECOVER never lets a client-chosen targetContentIdentity/targetPrescriptionIdentity into the grant', async () => {
    await authorizeWorkoutLifecycleMutationHandler({
      auth: { uid: UID },
      data: {
        operation: 'RECOVER', sourceProgramInstanceId: 'wpi_active', sourceCycleId: 'cyc_active',
        targetContentIdentity: 'wpg_attacker_chosen',
        targetPrescriptionIdentity: 'rx_attacker_chosen',
      },
    } as never, db);
    const grant = (await db.collection('users').doc(UID)
      .collection('workoutLifecycleAuthorityGrants').doc('current').get()).data();
    expect(grant?.targetContentIdentity).toBe('wpg_active');
    expect(grant?.targetPrescriptionIdentity).toBe('rx_active');
  });

  describe('PREPARE — canonical generation for promotion vs. cycle evolution/renewal', () => {
    async function seedEarnedFact(earnedFact: {
      type: string; quality: string; fromLevel: string; toLevel: string;
      sessionsCompletedAtEarn: number; adherenceAtEarnBp: number;
    }) {
      const earnedType = earnedFact.type === 'MOTIVATIONAL_RENEWAL' ? 'MOTIVATIONAL_RENEWAL_OFFERED' : 'EVOLUTION_EARNED';
      const earnedKey = `evolution:wpi_active:${earnedFact.type}`;
      await db.collection('users').doc(UID).collection('workoutLifecycleEvents')
        .doc(lifecycleEventId(earnedType, earnedKey)).set({
          idempotencyKey: earnedKey,
          payload: {
            evolutionType: earnedFact.type, quality: earnedFact.quality,
            fromLevel: earnedFact.fromLevel, toLevel: earnedFact.toLevel,
            sessionsCompletedAtEarn: earnedFact.sessionsCompletedAtEarn,
            adherenceAtEarnBp: earnedFact.adherenceAtEarnBp,
          },
        });
    }

    it('LEVEL_PROMOTION runs the full engine and seals a pendingEvolutions candidate the client never authored', async () => {
      const inputs = completeInputs();
      await db.collection('users').doc(UID).collection('programInstances').doc('wpi_active').update({
        prescriptionInputSnapshot: {
          snapshotId: 'pis_active', schemaVersion: 1, source: 'QUESTIONNAIRE_BASELINE', inputs,
        },
      });
      const earnedFact = {
        type: 'LEVEL_PROMOTION', quality: 'GOOD', fromLevel: 'BEGINNER', toLevel: 'INTERMEDIATE',
        sessionsCompletedAtEarn: 20, adherenceAtEarnBp: 8000,
      };
      await seedEarnedFact(earnedFact);
      const targetInputs = { ...inputs, level: 'intermediate' };
      const result = await authorizeWorkoutLifecycleMutationHandler({
        auth: { uid: UID },
        data: {
          operation: 'PREPARE', sourceProgramInstanceId: 'wpi_active', sourceCycleId: 'cyc_active',
          sourcePrescriptionInputSnapshotId: 'pis_active',
          targetProgramInstanceId: 'wpi_promoted', targetContentIdentity: 'wpg_client_guess',
          targetPrescriptionIdentity: 'rx_client_guess', pendingEvolutionId: 'pe_1',
          targetPlan: { planId: 'rx_client_guess', sessions: [{ exercises: [{ exerciseId: 'lat-pulldown', sets: 3 }] }] },
          targetPrescriptionInputSnapshot: {
            snapshotId: snapshotIdFor('LEVEL_PROMOTION', targetInputs),
            schemaVersion: 1, source: 'LEVEL_PROMOTION', inputs: targetInputs,
          },
          earnedFact,
        },
      } as never, db);
      expect(result.grantId).toBe('current');
      expect(result.canonical?.targetContentIdentity).toBeTruthy();
      expect(result.canonical?.targetContentIdentity).not.toBe('wpg_client_guess');
      const grant = (await db.collection('users').doc(UID)
        .collection('workoutLifecycleAuthorityGrants').doc('current').get()).data();
      expect(grant?.targetContentIdentity).not.toBe('wpg_client_guess');
      const plan = grant!.targetPlan as { sessions: Array<{ exercises: Array<{ exerciseId: string }> }> };
      expect(plan.sessions.length).toBeGreaterThan(0);
      expect(plan.sessions.flatMap((session) => session.exercises)[0].exerciseId).not.toBe('lat-pulldown');
    });

    it('CYCLE_EVOLUTION starts from the currently sealed sessions and only substitutes exercises, never the template/split/frequency', async () => {
      await db.collection('users').doc(UID).collection('workoutPrograms').doc('wpg_active').update({
        templateId: 'T003', split: 'upper/lower',
        templateVersion: 2, templateSourceVersion: '2.0.0', templateContentHash: 'a'.repeat(64),
        sessions: [{
          name: 'A', type: 'strength',
          exercises: [{ exerciseId: 'lat-pulldown', sourceExerciseId: 'lat-pulldown', sets: 3, reps: '8-10' }],
        }],
      });
      const inputs = completeInputs();
      await db.collection('users').doc(UID).collection('programInstances').doc('wpi_active').update({
        prescriptionInputSnapshot: {
          snapshotId: 'pis_active', schemaVersion: 1, source: 'QUESTIONNAIRE_BASELINE', inputs,
        },
      });
      const earnedFact = {
        type: 'CYCLE_EVOLUTION', quality: 'GOOD', fromLevel: 'BEGINNER', toLevel: 'BEGINNER',
        sessionsCompletedAtEarn: 20, adherenceAtEarnBp: 8000,
      };
      await seedEarnedFact(earnedFact);
      const result = await authorizeWorkoutLifecycleMutationHandler({
        auth: { uid: UID },
        data: {
          operation: 'PREPARE', sourceProgramInstanceId: 'wpi_active', sourceCycleId: 'cyc_active',
          sourcePrescriptionInputSnapshotId: 'pis_active',
          targetProgramInstanceId: 'wpi_evolved', targetContentIdentity: 'wpg_client_guess2',
          targetPrescriptionIdentity: 'rx_client_guess2', pendingEvolutionId: 'pe_2',
          // Irrelevant: a completely different (unsafe-looking) candidate —
          // never read for content.
          targetPlan: { planId: 'rx_client_guess2', sessions: [{ exercises: [{ exerciseId: 'lat-pulldown', sets: 1_000_000 }] }] },
          targetPrescriptionInputSnapshot: {
            snapshotId: snapshotIdFor('CYCLE_EVOLUTION', inputs),
            schemaVersion: 1, source: 'CYCLE_EVOLUTION', inputs,
          },
          earnedFact,
        },
      } as never, db);
      expect(result.grantId).toBe('current');
      const grant = (await db.collection('users').doc(UID)
        .collection('workoutLifecycleAuthorityGrants').doc('current').get()).data();
      const plan = grant!.targetPlan as { templateId: string; split: string; sessions: Array<{ exercises: Array<{ sets?: number }> }> };
      // Split/template preserved; only exercise-level substitution is allowed.
      expect(plan.templateId).toBe('T003');
      expect(plan.split).toBe('upper/lower');
      expect(plan.sessions).toHaveLength(1);
      expect(plan.sessions[0].exercises[0].sets).toBe(3);
    });

    it.each([
      ['no home equipment answered', []],
      ['every home equipment answered', ['dumbbells', 'bands', 'bench_or_box', 'barbell', 'bodyweight']],
    ] as const)(
      'v1.27 CYCLE_EVOLUTION picks the identical substitution regardless of answers.equipment (%s)',
      async (_label, equipment) => {
        await db.collection('users').doc(UID).collection('workoutPrograms').doc('wpg_active').update({
          templateId: 'T069', split: 'Upper/Lower', environment: 'home',
          versions: { templateLibrary: '1.27.0' },
          templateVersion: 2, templateSourceVersion: '1.27.0', templateContentHash: 'a'.repeat(64),
          sessions: [{
            name: 'Home A', type: 'strength',
            exercises: [
              { exerciseId: 'push-up', sourceExerciseId: 'push-up', sets: 3, reps: '8-15' },
              { exerciseId: 'one-arm-dumbbell-row', sourceExerciseId: 'one-arm-dumbbell-row', sets: 3, reps: '8-12' },
            ],
          }],
        });
        const inputs = completeInputs({ place: 'home', equipment });
        await db.collection('users').doc(UID).collection('programInstances').doc('wpi_active').update({
          prescriptionInputSnapshot: {
            snapshotId: 'pis_active', schemaVersion: 1, source: 'QUESTIONNAIRE_BASELINE', inputs,
          },
        });
        const earnedFact = {
          type: 'CYCLE_EVOLUTION', quality: 'GOOD', fromLevel: 'BEGINNER', toLevel: 'BEGINNER',
          sessionsCompletedAtEarn: 20, adherenceAtEarnBp: 8000,
        };
        await seedEarnedFact(earnedFact);
        const result = await authorizeWorkoutLifecycleMutationHandler({
          auth: { uid: UID },
          data: {
            operation: 'PREPARE', sourceProgramInstanceId: 'wpi_active', sourceCycleId: 'cyc_active',
            sourcePrescriptionInputSnapshotId: 'pis_active',
            targetProgramInstanceId: 'wpi_evolved', targetContentIdentity: 'wpg_client_guess3',
            targetPrescriptionIdentity: 'rx_client_guess3', pendingEvolutionId: 'pe_3',
            targetPlan: { planId: 'rx_client_guess3', sessions: [{ exercises: [{ exerciseId: 'lat-pulldown', sets: 1_000_000 }] }] },
            targetPrescriptionInputSnapshot: {
              snapshotId: snapshotIdFor('CYCLE_EVOLUTION', inputs),
              schemaVersion: 1, source: 'CYCLE_EVOLUTION', inputs,
            },
            earnedFact,
          },
        } as never, db);
        expect(result.grantId).toBe('current');
        const grant = (await db.collection('users').doc(UID)
          .collection('workoutLifecycleAuthorityGrants').doc('current').get()).data();
        const plan = grant!.targetPlan as { sessions: Array<{ exercises: Array<{ exerciseId: string }> }> };
        // Deterministic for `targetCycleIdentity: 'cyc_active:wpi_active'` regardless
        // of `equipment` — proven at the unit level in
        // `src/prescriptionEvolution/__tests__/cycleEvolution.test.ts`
        // ("equipment independence"). The same v2 mechanism
        // (`equipmentContextFor`) applied to this exact scenario WOULD have
        // produced a different exercise for the empty-equipment case
        // (preserves `one-arm-dumbbell-row` instead of substituting) —
        // this is the regression this test guards against.
        expect(plan.sessions[0].exercises[1].exerciseId).toBe('bent-over-dumbbell-row');
      },
    );
  });

  describe('COMPLETE_SCHEDULE — schedule decides the expected session, not the execution', () => {
    // Phase 10D-V (docs/workout-lifecycle/v2/architecture/
    // 24_PHASE_10DV_VERIFICATION_CLOSURE.md, GR-A/GR-B): the ACTUAL root
    // cause (confirmed via direct instrumentation of `resolveWorkoutSchedule`'s
    // inputs) is that the authoritative training-days source here is
    // `programInstances/wpi_active.prescriptionInputSnapshot.inputs.
    // trainingDays` — fixed to `['MON','WED','FRI']` by the outer, whole-file
    // `beforeEach` (`loadScheduleAuthorityContext` prefers this snapshot over
    // `workoutProgramState/scheduleConfig` whenever it's non-empty). Once the
    // real wall-clock weekday landed on TUE/THU/SAT/SUN, "today" simply
    // wasn't a trainingDay at all (occurrences.length === 0 → `REST_DAY`,
    // never `SESSION_READY`) — this test only ever passed by coincidence of
    // which real weekday it happened to run on, not because of any date/clock
    // race. `resolveWorkoutSchedule` itself is untouched and correct — fixed
    // by overriding the snapshot's `trainingDays` to today's ACTUAL weekday
    // (via the exact same `weekdayOfLocalDate` production helper), which
    // makes today a trainingDay — and therefore the anchor session
    // mathematically 0 (`position=0 % sessionCount`) — regardless of which
    // real weekday the suite runs on. "now" is captured exactly ONCE per
    // describe block and reused everywhere, to avoid a second, unrelated (if
    // unlikely) failure mode: two independent `Date.now()`/`new Date()` reads
    // landing on opposite sides of a UTC midnight boundary.
    const NOW_ONCE = new Date();
    const FIXED_TODAY = NOW_ONCE.toISOString().slice(0, 10);
    const FIXED_TODAY_WEEKDAY = weekdayOfLocalDate(FIXED_TODAY);

    beforeEach(async () => {
      await Promise.all([
        db.collection('users').doc(UID).collection('workoutPrograms').doc('wpg_active').set({
          programId: 'wpg_active', prescriptionId: 'rx_active',
          sessions: [
            { name: 'A (heavy)', exercises: [{ exerciseId: 'squat', sets: 3 }, { exerciseId: 'row', sets: 3 }] },
            { name: 'B (cheap)', exercises: [{ exerciseId: 'row', sets: 1 }] },
          ],
        }),
        db.collection('users').doc(UID).collection('workoutProgramState').doc('scheduleConfig').set({
          trainingDays: [FIXED_TODAY_WEEKDAY], timezone: 'UTC',
        }),
        // Same single captured instant as `FIXED_TODAY` — never a fresh
        // `Date.now()` read here — so the rotation's only occurrence to walk
        // is deterministically "today" and the anchor lands on session 0.
        // `prescriptionInputSnapshot.inputs.trainingDays` is the field
        // `loadScheduleAuthorityContext` actually consults first — it must
        // agree with `scheduleConfig` above or the latter is silently ignored.
        db.collection('users').doc(UID).collection('programInstances').doc('wpi_active').update({
          activatedAt: Timestamp.fromDate(NOW_ONCE),
          'prescriptionInputSnapshot.inputs.trainingDays': [FIXED_TODAY_WEEKDAY],
        }),
      ]);
    });

    function todayLocalDate(): string {
      return FIXED_TODAY;
    }

    async function seedFinishedExecution(sessionIndex: number, scheduledLocalDate: string) {
      await db.collection('users').doc(UID).collection('workoutExecutions').doc(`exec_${sessionIndex}`).set({
        status: 'COMPLETED', programInstanceId: 'wpi_active', sessionIndex, scheduledLocalDate,
      });
    }

    it('rejects an execution that self-selects the cheaper session instead of the rotation-owed one', async () => {
      const today = todayLocalDate();
      await seedFinishedExecution(1, today); // Attacker always claims the cheap session B.
      await expect(authorizeWorkoutLifecycleMutationHandler({
        auth: { uid: UID },
        data: {
          operation: 'COMPLETE_SCHEDULE', sourceProgramInstanceId: 'wpi_active',
          scheduledLocalDate: today, sessionIndex: 1,
        },
      } as never, db)).rejects.toMatchObject({ code: 'permission-denied' });
    });

    it('accepts the real rotation-owed session (index 0, the anchor) for a fresh program', async () => {
      const today = todayLocalDate();
      await seedFinishedExecution(0, today);
      await expect(authorizeWorkoutLifecycleMutationHandler({
        auth: { uid: UID },
        data: {
          operation: 'COMPLETE_SCHEDULE', sourceProgramInstanceId: 'wpi_active',
          scheduledLocalDate: today, sessionIndex: 0,
        },
      } as never, db)).resolves.toMatchObject({ grantId: 'current' });
      const grant = (await db.collection('users').doc(UID)
        .collection('workoutLifecycleAuthorityGrants').doc('current').get()).data();
      expect(grant).toMatchObject({ targetNextSessionIndex: 1, targetCursorDate: today });
    });

    it('uses the program weeklySchedule instead of broader questionnaire availability', async () => {
      const today = todayLocalDate();
      const otherWeekday = weekdayOfLocalDate(new Date(NOW_ONCE.getTime() + 86_400_000).toISOString().slice(0, 10));
      await Promise.all([
        db.collection('users').doc(UID).collection('workoutPrograms').doc('wpg_active').update({
          prescribedTrainingFrequency: 2,
          weeklySchedule: [
            { weekday: FIXED_TODAY_WEEKDAY, state: 'TRAINING', sessionIndex: 0 },
            { weekday: otherWeekday, state: 'TRAINING', sessionIndex: 1 },
          ],
        }),
        db.collection('users').doc(UID).collection('programInstances').doc('wpi_active').update({
          'prescriptionInputSnapshot.inputs.trainingDays': [otherWeekday],
        }),
      ]);
      await seedFinishedExecution(0, today);

      await expect(authorizeWorkoutLifecycleMutationHandler({
        auth: { uid: UID },
        data: {
          operation: 'COMPLETE_SCHEDULE', sourceProgramInstanceId: 'wpi_active',
          scheduledLocalDate: today, sessionIndex: 0,
        },
      } as never, db)).resolves.toMatchObject({ grantId: 'current' });
    });

    it('rejects a historically backdated completion outside the offline-sync grace window', async () => {
      const stale = new Date(NOW_ONCE.getTime() - 10 * 86_400_000).toISOString().slice(0, 10);
      await seedFinishedExecution(0, stale);
      await expect(authorizeWorkoutLifecycleMutationHandler({
        auth: { uid: UID },
        data: {
          operation: 'COMPLETE_SCHEDULE', sourceProgramInstanceId: 'wpi_active',
          scheduledLocalDate: stale, sessionIndex: 0,
        },
      } as never, db)).rejects.toMatchObject({ code: 'permission-denied' });
    });

    it('rejects a future-dated completion (backdating grace never permits post-dating)', async () => {
      const future = new Date(NOW_ONCE.getTime() + 2 * 86_400_000).toISOString().slice(0, 10);
      await seedFinishedExecution(0, future);
      await expect(authorizeWorkoutLifecycleMutationHandler({
        auth: { uid: UID },
        data: {
          operation: 'COMPLETE_SCHEDULE', sourceProgramInstanceId: 'wpi_active',
          scheduledLocalDate: future, sessionIndex: 0,
        },
      } as never, db)).rejects.toMatchObject({ code: 'permission-denied', message: 'schedule_completion_date_out_of_grace_window' });
    });

    // Phase 10D-V VG-D/VG-E (docs/workout-lifecycle/v2/architecture/
    // 24_PHASE_10DV_VERIFICATION_CLOSURE.md): `loadScheduleAuthorityContext`
    // always reads `bundle.state.activeProgramInstanceId` — the CURRENT
    // pointer from `workoutLifecycleState/current`, never a client-supplied
    // instance — and anchors the rotation's walk at THAT instance's own
    // `activatedAt` (`resolveWorkoutSchedule`'s `cursorDate = state?.cursorDate
    // ?? addDaysLocal(activatedAtLocalDate, -1)`). A date before the CURRENT
    // instance's own activation can therefore never resolve to
    // `SESSION_READY` for it, regardless of what a prior (now-superseded)
    // instance's rotation looked like on that date — structurally preventing
    // credit from leaking across a ProgramInstance boundary (whether the
    // switch happened via ADAPT, evolution activation, or anything else that
    // changes `activeProgramInstanceId`), without needing per-boundary
    // special-casing.
    it('VG-D/VG-E: a backdated completion cannot leak credit across a ProgramInstance switch (e.g. ADAPT)', async () => {
      const backdatedBeforeSwitch = new Date(NOW_ONCE.getTime() - 2 * 86_400_000).toISOString().slice(0, 10);
      // Simulate the account having just switched to a NEW instance today
      // (as ADAPT/evolution-activation would do) — the OLD instance
      // ('wpi_active') keeps existing as history, but is no longer current.
      await db.collection('users').doc(UID).collection('programInstances').doc('wpi_new').set({
        programInstanceId: 'wpi_new', cycleId: 'cyc_active', contentIdentity: 'wpg_active',
        prescriptionIdentity: 'rx_active', activatedAt: Timestamp.fromDate(NOW_ONCE),
        prescriptionInputSnapshot: {
          snapshotId: 'pis_active', schemaVersion: 1, source: 'QUESTIONNAIRE_BASELINE',
          inputs: { level: 'beginner', trainingDays: ['MON', 'WED', 'FRI'] },
        },
      });
      await db.collection('users').doc(UID).collection('workoutLifecycleState').doc('current')
        .update({ activeProgramInstanceId: 'wpi_new' });
      // The client claims an execution finished 2 days ago (within the
      // 3-day grace window) — but that's BEFORE 'wpi_new' ever existed; it
      // could only legitimately belong to the old 'wpi_active' period.
      await db.collection('users').doc(UID).collection('workoutExecutions').doc('exec_leak').set({
        status: 'COMPLETED', programInstanceId: 'wpi_new', sessionIndex: 0, scheduledLocalDate: backdatedBeforeSwitch,
      });
      await expect(authorizeWorkoutLifecycleMutationHandler({
        auth: { uid: UID },
        data: {
          operation: 'COMPLETE_SCHEDULE', sourceProgramInstanceId: 'wpi_new',
          scheduledLocalDate: backdatedBeforeSwitch, sessionIndex: 0,
        },
      } as never, db)).rejects.toMatchObject({ code: 'permission-denied', message: 'schedule_completion_session_not_expected' });
    });
  });

  // Phase 10E stale-device test (docs/workout-lifecycle/v2/architecture/
  // 26_FINAL_INDEPENDENT_ADVERSARIAL_AUDIT_2.md §92, 27_PHASE_10E_FINAL_
  // STAGED_ROLLOUT_CLOSURE.md §33-34). "Device A reads state X. Device B
  // advances the lifecycle X→Y. Device A later submits a mutation derived
  // from stale X." Chosen operation: ADAPT, the highest-risk
  // content-producing transition. `assertSource` (authorizeMutation.ts:152)
  // is the mechanism under test — it must fail closed the moment a
  // request's `sourceProgramInstanceId`/`sourceCycleId` no longer matches
  // the CURRENT authoritative state, regardless of how that mismatch arose
  // (a genuine two-device race is just one way to reach this state; a
  // single stale in-memory client cache after any prior mutation reaches
  // the exact same code path).
  describe('stale-device mutation (Device A reads X, Device B advances to Y, Device A submits stale X)', () => {
    it('denies an ADAPT whose sourceProgramInstanceId/sourceCycleId no longer match current state, and does not mutate authoritative state', async () => {
      // Device A's read, at the start of the test: activeProgramInstanceId
      // = 'wpi_active', currentCycleId = 'cyc_active' (seeded by the outer
      // beforeEach — this IS "state X").
      // Device B advances the lifecycle to a new instance/cycle — "state Y"
      // — via a legitimate-shaped direct write (standing in for a real
      // ADAPT/PREPARE+ACTIVATE that already completed on another device).
      await db.collection('users').doc(UID).collection('programInstances').doc('wpi_device_b').set({
        programInstanceId: 'wpi_device_b', cycleId: 'cyc_device_b', contentIdentity: 'wpg_active',
        prescriptionIdentity: 'rx_active', activatedAt: Timestamp.now(),
        prescriptionInputSnapshot: {
          snapshotId: 'pis_device_b', schemaVersion: 1, source: 'QUESTIONNAIRE_BASELINE',
          inputs: { level: 'beginner', trainingDays: ['MON', 'WED', 'FRI'] },
        },
      });
      await db.collection('users').doc(UID).collection('trainingCycles').doc('cyc_device_b').set({
        cycleId: 'cyc_device_b', level: 'BEGINNER', cycleNumber: 1, status: 'ACTIVE',
        programInstanceId: 'wpi_device_b',
      });
      await db.collection('users').doc(UID).collection('workoutLifecycleState').doc('current')
        .update({ activeProgramInstanceId: 'wpi_device_b', currentCycleId: 'cyc_device_b' });

      // Device A, unaware of Device B's change, submits an ADAPT still
      // bound to its stale read of state X.
      await expect(authorizeWorkoutLifecycleMutationHandler({
        auth: { uid: UID },
        data: {
          operation: 'ADAPT', targetProgramSource: 'program_adaptation',
          sourceProgramInstanceId: 'wpi_active', sourceCycleId: 'cyc_active',
        },
      } as never, db)).rejects.toMatchObject({ code: 'aborted', message: 'stale_lifecycle_authority_base' });

      // Authoritative state must still point at Device B's advance — never
      // overwritten, never duplicated, no grant issued for the stale request.
      const state = (await db.collection('users').doc(UID).collection('workoutLifecycleState').doc('current').get()).data();
      expect(state?.activeProgramInstanceId).toBe('wpi_device_b');
      expect(state?.currentCycleId).toBe('cyc_device_b');
      expect((await db.collection('users').doc(UID)
        .collection('workoutLifecycleAuthorityGrants').doc('current').get()).exists).toBe(false);
    });

    it('a fresh read of the CURRENT state (Device A catching up) is accepted normally', async () => {
      await db.collection('users').doc(UID).collection('programInstances').doc('wpi_device_b').set({
        programInstanceId: 'wpi_device_b', cycleId: 'cyc_device_b', contentIdentity: 'wpg_active',
        prescriptionIdentity: 'rx_active', activatedAt: Timestamp.now(),
        prescriptionInputSnapshot: {
          snapshotId: 'pis_device_b', schemaVersion: 1, source: 'QUESTIONNAIRE_BASELINE',
          inputs: { level: 'beginner', trainingDays: ['MON', 'WED', 'FRI'] },
        },
      });
      await db.collection('users').doc(UID).collection('trainingCycles').doc('cyc_device_b').set({
        cycleId: 'cyc_device_b', level: 'BEGINNER', cycleNumber: 1, status: 'ACTIVE',
        programInstanceId: 'wpi_device_b',
      });
      await db.collection('users').doc(UID).collection('workoutLifecycleState').doc('current')
        .update({ activeProgramInstanceId: 'wpi_device_b', currentCycleId: 'cyc_device_b' });

      // Never rejected for staleness once the source matches CURRENT state
      // (it may still fail later for other request-shape reasons unrelated
      // to this test).
      await expect(authorizeWorkoutLifecycleMutationHandler({
        auth: { uid: UID },
        data: {
          operation: 'ADAPT', targetProgramSource: 'program_adaptation',
          sourceProgramInstanceId: 'wpi_device_b', sourceCycleId: 'cyc_device_b',
        },
      } as never, db)).rejects.not.toMatchObject({ message: 'stale_lifecycle_authority_base' });
    });
  });

  describe('RESOLVE_MISSED_SESSION — displayed decision identity', () => {
    const today = new Date().toISOString().slice(0, 10);
    const shift = (days: number) => new Date(Date.parse(`${today}T00:00:00.000Z`) + days * 86_400_000)
      .toISOString().slice(0, 10);
    const missedScheduledDate = shift(-1);

    beforeEach(async () => {
      await Promise.all([
        db.collection('users').doc(UID).collection('workoutPrograms').doc('wpg_active').update({
          sessions: [{ name: 'A', exercises: [] }, { name: 'B', exercises: [] }],
        }),
        db.collection('users').doc(UID).collection('workoutProgramState').doc('scheduleConfig').set({
          trainingDays: ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'], timezone: 'UTC',
        }),
        db.collection('users').doc(UID).collection('programInstances').doc('wpi_active').update({
          activatedAt: Timestamp.fromDate(new Date(`${shift(-3)}T00:00:00.000Z`)),
          'prescriptionInputSnapshot.inputs.trainingDays': ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'],
        }),
        db.collection('users').doc(UID).collection('workoutPrograms').doc('wpg_active')
          .collection('scheduleState').doc('wpi_active').set({
            programId: 'wpg_active', programInstanceId: 'wpi_active',
            nextSessionIndex: 0, cursorDate: shift(-2), lastCompletedAt: shift(-2),
            pendingMissDecision: {
              missedSessionIndex: 0, calendarSessionIndex: 1,
              missedScheduledDate, detectedOnDate: today,
            },
          }),
      ]);
    });

    const request = (overrides: Record<string, unknown> = {}) => ({
      auth: { uid: UID },
      data: {
        operation: 'RESOLVE_MISSED_SESSION', sourceProgramInstanceId: 'wpi_active',
        scheduledLocalDate: today, decision: 'CONTINUE_SEQUENCE',
        expectedMissedSessionIndex: 0, expectedCalendarSessionIndex: 1,
        expectedMissedScheduledDate: missedScheduledDate,
        ...overrides,
      },
    });

    it('authorizes the exact pending occurrence shown by the client', async () => {
      await expect(authorizeWorkoutLifecycleMutationHandler(request() as never, db))
        .resolves.toMatchObject({ grantId: 'current' });
    });

    it('rejects an old modal identity when a different decision is now canonical', async () => {
      await expect(authorizeWorkoutLifecycleMutationHandler(request({
        expectedMissedScheduledDate: shift(-2),
      }) as never, db)).rejects.toMatchObject({ code: 'aborted', message: 'stale_missed_session_decision' });
    });

    it('keeps no-pending distinct when the authoritative calendar has no gap', async () => {
      await db.collection('users').doc(UID).collection('workoutPrograms').doc('wpg_active')
        .collection('scheduleState').doc('wpi_active').update({ cursorDate: missedScheduledDate });
      await expect(authorizeWorkoutLifecycleMutationHandler(request() as never, db))
        .rejects.toMatchObject({ code: 'failed-precondition', message: 'no_pending_missed_session_decision' });
    });

    it('rejects calls that omit decision identity instead of authorizing an unversioned choice', async () => {
      await expect(authorizeWorkoutLifecycleMutationHandler({
        auth: { uid: UID },
        data: {
          operation: 'RESOLVE_MISSED_SESSION', sourceProgramInstanceId: 'wpi_active',
          scheduledLocalDate: today, decision: 'CONTINUE_SEQUENCE',
        },
      } as never, db)).rejects.toMatchObject({
        code: 'invalid-argument', message: 'missing_missed_session_decision_identity',
      });
    });
  });

  describe('REPOSITION_SCHEDULE_CURSOR — authoritative sequence reposition', () => {
    const today = new Date().toISOString().slice(0, 10);

    beforeEach(async () => {
      const root = db.collection('users').doc(UID);
      await Promise.all([
        root.collection('workoutPrograms').doc('wpg_active').update({
          scheduleMode: 'flexible', prescribedTrainingFrequency: 3, weeklySchedule: [],
          sessions: [{ name: 'A', exercises: [] }, { name: 'B', exercises: [] }, { name: 'C', exercises: [] }],
        }),
        root.collection('workoutProgramState').doc('scheduleConfig').set({
          scheduleMode: 'flexible', trainingDays: [], timezone: 'UTC', scheduleVersion: 1,
        }),
      ]);
    });

    const request = (targetSessionIndex: number, expectedCurrentNextSessionIndex = 0) => ({
      auth: { uid: UID },
      data: {
        operation: 'REPOSITION_SCHEDULE_CURSOR', sourceProgramInstanceId: 'wpi_active',
        targetSessionIndex, expectedCurrentNextSessionIndex, scheduledLocalDate: today,
      },
    });

    it('grants a forward path as neutral REPOSITIONED events and same-index as no-op', async () => {
      await expect(authorizeWorkoutLifecycleMutationHandler(request(2) as never, db))
        .resolves.toMatchObject({ grantId: 'current' });
      let grant = (await db.collection('users').doc(UID).collection('workoutLifecycleAuthorityGrants').doc('current').get()).data();
      expect(grant).toMatchObject({
        operation: 'REPOSITION_SCHEDULE_CURSOR', targetNextSessionIndex: 2,
        targetScheduleEvents: [
          { type: 'REPOSITIONED', sessionIndex: 0, scheduledDate: today },
          { type: 'REPOSITIONED', sessionIndex: 1, scheduledDate: today },
        ],
      });
      await expect(authorizeWorkoutLifecycleMutationHandler(request(0) as never, db))
        .resolves.toMatchObject({ grantId: 'current' });
      grant = (await db.collection('users').doc(UID).collection('workoutLifecycleAuthorityGrants').doc('current').get()).data();
      expect(grant?.targetScheduleEvents).toEqual([]);
    });

    it('rejects stale/out-of-range cursors', async () => {
      await expect(authorizeWorkoutLifecycleMutationHandler(request(2, 1) as never, db))
        .rejects.toMatchObject({ code: 'aborted' });
      await expect(authorizeWorkoutLifecycleMutationHandler(request(3) as never, db))
        .rejects.toMatchObject({ code: 'invalid-argument' });
    });

    it('blocks IN_PROGRESS and a target already completed today', async () => {
      const executions = db.collection('users').doc(UID).collection('workoutExecutions');
      await executions.doc('active').set({ programInstanceId: 'wpi_active', sessionIndex: 1, status: 'IN_PROGRESS' });
      await expect(authorizeWorkoutLifecycleMutationHandler(request(1) as never, db))
        .rejects.toMatchObject({ code: 'failed-precondition' });
      await executions.doc('active').delete();
      await executions.doc('done').set({
        programInstanceId: 'wpi_active', sessionIndex: 1, scheduledLocalDate: today, status: 'COMPLETED',
      });
      await expect(authorizeWorkoutLifecycleMutationHandler(request(1) as never, db))
        .rejects.toMatchObject({ code: 'failed-precondition' });
    });

    it('accepts the real five-session wrap 4→0 even when prescribed weekly frequency is 4', async () => {
      const root = db.collection('users').doc(UID);
      await Promise.all([
        root.collection('workoutPrograms').doc('wpg_active').update({
          prescribedTrainingFrequency: 4,
          sessions: [
            { name: 'Empurrar', exercises: [] },
            { name: 'Puxar', exercises: [] },
            { name: 'Pernas', exercises: [] },
            { name: 'Superiores Extra', exercises: [] },
            { name: 'Inferiores Extra', exercises: [] },
          ],
        }),
        root.collection('workoutPrograms').doc('wpg_active').collection('scheduleState').doc('wpi_active').set({
          programId: 'wpg_active', programInstanceId: 'wpi_active',
          nextSessionIndex: 4, cursorDate: today, lastCompletedAt: null,
          pendingMissDecision: null,
        }),
      ]);

      await expect(authorizeWorkoutLifecycleMutationHandler(request(0, 4) as never, db))
        .resolves.toMatchObject({ grantId: 'current' });
      const grant = (await root.collection('workoutLifecycleAuthorityGrants').doc('current').get()).data();
      expect(grant).toMatchObject({
        operation: 'REPOSITION_SCHEDULE_CURSOR',
        expectedCurrentNextSessionIndex: 4,
        targetNextSessionIndex: 0,
        targetScheduleEvents: [{ type: 'REPOSITIONED', sessionIndex: 4, scheduledDate: today }],
      });
      expect(grant?.targetScheduleEvents.some((event: { type: string }) => event.type === 'SKIPPED')).toBe(false);
    });
  });

  // Phase 10E circuit breaker (docs/workout-lifecycle/v2/architecture/
  // 26_FINAL_INDEPENDENT_ADVERSARIAL_AUDIT_2.md §50, 27_PHASE_10E_FINAL_
  // STAGED_ROLLOUT_CLOSURE.md §16-21). Deliberately separate from
  // `workoutLifecycleRolloutConfig` (which only ever gates brand-new V1→V2
  // migrations) — this account already has V2 lifecycle state (seeded in
  // the outer `beforeEach`), matching the "already-migrated user" scenario
  // the audit brief's kill-switch scenario names explicitly. Backend-
  // enforced: the circuit-breaker check runs before any request-specific
  // validation, so even a garbage/incomplete payload for a blocked
  // operation is denied for the circuit-breaker reason specifically, not
  // some other validation error — proving an old/modified client cannot
  // route around it by sending a different shape.
  describe('circuit breaker — already-migrated V2 account', () => {
    async function setCircuitBreaker(open: boolean) {
      await db.collection('workoutLifecycleCircuitBreaker').doc('active').set({ schemaVersion: 1, open });
    }

    it.each(['INITIALIZE', 'MIGRATE', 'PREPARE', 'ACTIVATE', 'ADAPT'] as const)(
      'denies %s outright when the circuit is open, before any other validation',
      async (operation) => {
        await setCircuitBreaker(true);
        await expect(authorizeWorkoutLifecycleMutationHandler({
          auth: { uid: UID },
          // Deliberately minimal/incomplete payload — if the circuit-breaker
          // check did not run first, this would fail with some OTHER
          // validation error instead.
          data: { operation },
        } as never, db)).rejects.toMatchObject({ code: 'unavailable', message: 'workout_lifecycle_circuit_breaker_open' });
        expect((await db.collection('users').doc(UID)
          .collection('workoutLifecycleAuthorityGrants').doc('current').get()).exists).toBe(false);
      },
    );

    // RECOVER is covered separately below (it succeeds outright with this
    // fixture's seeded state, which is an even stronger proof it isn't
    // blocked than "rejects for some other reason").
    it.each(['EARN', 'DEFER', 'FINISH_EXECUTION', 'COMPLETE_SCHEDULE', 'RESOLVE_MISSED_SESSION'] as const)(
      '%s is not blocked by an open circuit (fails, if at all, for its own normal validation reasons)',
      async (operation) => {
        await setCircuitBreaker(true);
        await expect(authorizeWorkoutLifecycleMutationHandler({
          auth: { uid: UID },
          data: { operation },
        } as never, db)).rejects.not.toMatchObject({ message: 'workout_lifecycle_circuit_breaker_open' });
      },
    );

    it('RECOVER succeeds normally while the circuit is open (safe reconciliation stays available)', async () => {
      await setCircuitBreaker(true);
      await expect(authorizeWorkoutLifecycleMutationHandler({
        auth: { uid: UID },
        data: { operation: 'RECOVER', sourceProgramInstanceId: 'wpi_active', sourceCycleId: 'cyc_active' },
      } as never, db)).resolves.toMatchObject({ grantId: 'current' });
    });

    it('ADAPT is denied while open, then succeeds normally once the circuit is closed again (resume after reopen)', async () => {
      await setCircuitBreaker(true);
      await expect(authorizeWorkoutLifecycleMutationHandler({
        auth: { uid: UID },
        data: { operation: 'ADAPT', targetProgramSource: 'program_adaptation' },
      } as never, db)).rejects.toMatchObject({ code: 'unavailable', message: 'workout_lifecycle_circuit_breaker_open' });

      await setCircuitBreaker(false);
      // No longer blocked by the circuit breaker specifically — it may
      // still fail for an unrelated reason (this fixture's minimal ADAPT
      // payload isn't a full valid request), but never for the
      // circuit-breaker message, proving resume-after-reopen works.
      await expect(authorizeWorkoutLifecycleMutationHandler({
        auth: { uid: UID },
        data: { operation: 'ADAPT', targetProgramSource: 'program_adaptation' },
      } as never, db)).rejects.not.toMatchObject({ message: 'workout_lifecycle_circuit_breaker_open' });
    });

    it('a missing circuit-breaker config document fails closed to normal operation (not to blocking everything)', async () => {
      // No setCircuitBreaker call at all — the doc never exists, matching a
      // fresh environment that has never configured this collection.
      await expect(authorizeWorkoutLifecycleMutationHandler({
        auth: { uid: UID },
        data: { operation: 'RECOVER', sourceProgramInstanceId: 'wpi_active', sourceCycleId: 'cyc_active' },
      } as never, db)).resolves.toMatchObject({ grantId: 'current' });
    });

    it('a malformed circuit-breaker config document fails closed to normal operation', async () => {
      await db.collection('workoutLifecycleCircuitBreaker').doc('active').set({ garbage: true });
      await expect(authorizeWorkoutLifecycleMutationHandler({
        auth: { uid: UID },
        data: { operation: 'RECOVER', sourceProgramInstanceId: 'wpi_active', sourceCycleId: 'cyc_active' },
      } as never, db)).resolves.toMatchObject({ grantId: 'current' });
    });
  });

  describe('EARN — QA_TRANSITION eligibility bypass (docs/workout-lifecycle/v2/qa/)', () => {
    // Fixture account: BEGINNER, activatedAt ~1 day ago, zero executions —
    // activeDays is far below even QA_ACCELERATED's 7-day floor and
    // adherence is 0%. Real progression, and QA_ACCELERATED's compressed
    // progression, must both still deny EARN for this account. Only
    // QA_TRANSITION may.
    async function setQaMode(mode: 'ACCELERATED' | 'TRANSITION' | null) {
      await db.collection('users').doc(UID).set({
        metadata: mode ? { role: 'user', workoutLifecycleQaMode: mode } : { role: 'user' },
      });
    }

    it('NORMAL account: not eligible — real progression is never bypassed', async () => {
      await setQaMode(null);
      await expect(authoritativeEarnedFact(UID, db, new Date()))
        .rejects.toMatchObject({ message: 'progression_not_eligible' });
    });

    it('QA_ACCELERATED account: still not eligible — ACCELERATED compresses time, it never skips the gate', async () => {
      await setQaMode('ACCELERATED');
      await expect(authoritativeEarnedFact(UID, db, new Date()))
        .rejects.toMatchObject({ message: 'progression_not_eligible' });
    });

    // P0 integrity fix (2026-09, docs/workout-lifecycle/ — production
    // incident): parity with the client resolver
    // (`src/progressionEngineV2/resolver.ts`'s `hasInProgressExecution`
    // check) — an IN_PROGRESS execution for the active instance must block
    // EARN authoritatively too, not just on the client. QA_TRANSITION
    // deliberately used here BECAUSE it otherwise always succeeds (proven by
    // the test below) — this isolates that the new IN_PROGRESS check runs
    // independently of, and before, every other eligibility bypass.
    it('an IN_PROGRESS execution for the active instance blocks EARN even under QA_TRANSITION', async () => {
      await setQaMode('TRANSITION');
      await db.collection('users').doc(UID).collection('workoutExecutions').doc('exec_pending').set({
        status: 'IN_PROGRESS', programInstanceId: 'wpi_active', sessionIndex: 0,
        scheduledLocalDate: '2026-01-01',
      });
      await expect(authoritativeEarnedFact(UID, db, new Date()))
        .rejects.toMatchObject({ message: 'progression_blocked_by_in_progress_execution' });
    });

    it('once the blocking IN_PROGRESS execution resolves (COMPLETED), EARN succeeds again', async () => {
      await setQaMode('TRANSITION');
      const ref = db.collection('users').doc(UID).collection('workoutExecutions').doc('exec_pending');
      await ref.set({
        status: 'IN_PROGRESS', programInstanceId: 'wpi_active', sessionIndex: 0,
        scheduledLocalDate: '2026-01-01',
      });
      await expect(authoritativeEarnedFact(UID, db, new Date()))
        .rejects.toMatchObject({ message: 'progression_blocked_by_in_progress_execution' });
      await ref.set({ status: 'COMPLETED', programInstanceId: 'wpi_active', sessionIndex: 0, scheduledLocalDate: '2026-01-01' });
      await expect(authoritativeEarnedFact(UID, db, new Date())).resolves.toMatchObject({ qaForced: true });
    });

    it('an IN_PROGRESS execution for a DIFFERENT (superseded) program instance does NOT block EARN', async () => {
      await setQaMode('TRANSITION');
      await db.collection('users').doc(UID).collection('workoutExecutions').doc('exec_other').set({
        status: 'IN_PROGRESS', programInstanceId: 'wpi_superseded', sessionIndex: 0,
        scheduledLocalDate: '2026-01-01',
      });
      await expect(authoritativeEarnedFact(UID, db, new Date())).resolves.toMatchObject({ qaForced: true });
    });

    it('QA_TRANSITION account: EARN succeeds despite ~1 active day and 0% adherence, deriving the real BEGINNER -> INTERMEDIATE target', async () => {
      await setQaMode('TRANSITION');
      const now = new Date();
      const fact = await authoritativeEarnedFact(UID, db, now);
      expect(fact).toMatchObject({
        type: 'LEVEL_PROMOTION', fromLevel: 'BEGINNER', toLevel: 'INTERMEDIATE',
        qaForced: true, triggerSource: 'QA_TRANSITION',
      });
      await expect(authoritativeEarnedFactFullScanOracleForTest(UID, db, now)).resolves.toEqual(fact);
    });

    it('matches the old full-scan oracle at the INTERMEDIATE promotion boundary with 120 irrelevant historical cycles and on retry', async () => {
      await setQaMode('TRANSITION');
      const root = db.collection('users').doc(UID);
      const batch = db.batch();
      batch.update(root.collection('workoutLifecycleState').doc('current'), {
        currentTrainingLevel: 'INTERMEDIATE', currentCycleId: 'cyc_intermediate_4', currentCycleNumber: 4,
      });
      batch.update(root.collection('programInstances').doc('wpi_active'), { cycleId: 'cyc_intermediate_4' });
      for (let cycleNumber = 1; cycleNumber <= 4; cycleNumber += 1) {
        batch.set(root.collection('trainingCycles').doc(`cyc_intermediate_${cycleNumber}`), {
          cycleId: `cyc_intermediate_${cycleNumber}`, level: 'INTERMEDIATE', cycleNumber,
          status: cycleNumber === 4 ? 'ACTIVE' : 'COMPLETED',
          progressionReason: cycleNumber === 1 ? 'INITIAL_PRESCRIPTION' : 'EARNED_CYCLE_EVOLUTION',
          completionReason: cycleNumber === 4 ? null : 'EARNED_EVOLUTION',
        });
      }
      for (let index = 0; index < 120; index += 1) {
        batch.set(root.collection('trainingCycles').doc(`irrelevant_${index}`), {
          cycleId: `irrelevant_${index}`, level: index % 2 === 0 ? 'BEGINNER' : 'ADVANCED',
          cycleNumber: index + 100, status: 'COMPLETED', progressionReason: 'EARNED_CYCLE_EVOLUTION',
          completionReason: 'EARNED_EVOLUTION',
        });
      }
      await batch.commit();

      const fullSnapshot = await root.collection('trainingCycles').get();
      const oldFullScanCount = countEarnedIntermediateCycles(fullSnapshot.docs.map((item) => item.data() as never));
      const oldFullScanType = oldFullScanCount + 1 >= 4 ? 'LEVEL_PROMOTION' : 'CYCLE_EVOLUTION';
      const now = new Date();
      const fullScanOracle = await authoritativeEarnedFactFullScanOracleForTest(UID, db, now);
      const first = await authoritativeEarnedFact(UID, db, now);
      const retry = await authoritativeEarnedFact(UID, db, now);

      expect(first.type).toBe(oldFullScanType);
      expect(first).toMatchObject({ fromLevel: 'INTERMEDIATE', toLevel: 'ADVANCED' });
      expect(first).toEqual(fullScanOracle);
      expect(retry).toEqual(first);
    });

    it('is structurally identical to the old full-scan result across valid level/cycle histories', async () => {
      await setQaMode('TRANSITION');
      const root = db.collection('users').doc(UID);
      const scenarios = [
        { name: 'BEGINNER initial', level: 'BEGINNER', current: 1, completedIntermediate: 0 },
        { name: 'INTERMEDIATE cycle 1', level: 'INTERMEDIATE', current: 1, completedIntermediate: 0 },
        { name: 'INTERMEDIATE cycle 2', level: 'INTERMEDIATE', current: 2, completedIntermediate: 1 },
        { name: 'several INTERMEDIATE cycles', level: 'INTERMEDIATE', current: 3, completedIntermediate: 2 },
        { name: 'promotion boundary', level: 'INTERMEDIATE', current: 4, completedIntermediate: 3 },
        { name: 'ADVANCED after promotion', level: 'ADVANCED', current: 1, completedIntermediate: 4 },
      ] as const;

      for (const scenario of scenarios) {
        const existing = await root.collection('trainingCycles').get();
        const cleanup = db.batch();
        existing.docs.forEach((item) => cleanup.delete(item.ref));
        await cleanup.commit();

        const activeCycleId = `active_${scenario.level}_${scenario.current}`;
        const seed = db.batch();
        seed.update(root.collection('workoutLifecycleState').doc('current'), {
          currentTrainingLevel: scenario.level, currentCycleId: activeCycleId, currentCycleNumber: scenario.current,
        });
        for (let cycleNumber = 1; cycleNumber <= scenario.completedIntermediate; cycleNumber += 1) {
          seed.set(root.collection('trainingCycles').doc(`completed_${cycleNumber}`), {
            cycleId: `completed_${cycleNumber}`, level: 'INTERMEDIATE', cycleNumber, status: 'COMPLETED',
            progressionReason: cycleNumber === 1 ? 'INITIAL_PRESCRIPTION' : 'EARNED_CYCLE_EVOLUTION',
            completionReason: 'EARNED_EVOLUTION',
          });
        }
        seed.set(root.collection('trainingCycles').doc(activeCycleId), {
          cycleId: activeCycleId, level: scenario.level, cycleNumber: scenario.current, status: 'ACTIVE',
          progressionReason: scenario.level === 'BEGINNER' ? 'INITIAL_PRESCRIPTION' : 'EARNED_LEVEL_PROMOTION',
          completionReason: null,
        });
        await seed.commit();

        const now = new Date();
        const oldResult = await authoritativeEarnedFactFullScanOracleForTest(UID, db, now);
        const newResult = await authoritativeEarnedFact(UID, db, now);
        expect(newResult, scenario.name).toEqual(oldResult);
      }
    });

    it('legacy boolean fallback: workoutLifecycleQaAccelerated=true alone never implies QA_TRANSITION', async () => {
      await db.collection('users').doc(UID).set({ metadata: { role: 'user', workoutLifecycleQaAccelerated: true } });
      await expect(authoritativeEarnedFact(UID, db, new Date()))
        .rejects.toMatchObject({ message: 'progression_not_eligible' });
    });

    it('mutual exclusivity: the new field always wins over the legacy boolean, in both directions', async () => {
      await db.collection('users').doc(UID).set({
        metadata: { role: 'user', workoutLifecycleQaMode: 'TRANSITION', workoutLifecycleQaAccelerated: false },
      });
      const forced = await authoritativeEarnedFact(UID, db, new Date());
      expect(forced.qaForced).toBe(true);

      await db.collection('users').doc(UID).set({
        metadata: { role: 'user', workoutLifecycleQaMode: 'ACCELERATED', workoutLifecycleQaAccelerated: true },
      });
      // ACCELERATED (not TRANSITION) still denies this fixture's ~1 active day.
      await expect(authoritativeEarnedFact(UID, db, new Date()))
        .rejects.toMatchObject({ message: 'progression_not_eligible' });
    });

    describe('full EARN operation — client cannot forge the target', () => {
      function earnRequest(idempotencyKey: string, earnedFact: Record<string, unknown>) {
        return {
          auth: { uid: UID },
          data: {
            operation: 'EARN', sourceProgramInstanceId: 'wpi_active', sourceCycleId: 'cyc_active',
            sourcePrescriptionInputSnapshotId: 'pis_active',
            eventType: 'EVOLUTION_EARNED', idempotencyKey,
            eventId: lifecycleEventId('EVOLUTION_EARNED', idempotencyKey),
            earnedFact,
          },
        } as never;
      }

      it('NORMAL account sending a QA-shaped earnedFact via the real EARN operation is denied', async () => {
        await setQaMode(null);
        await expect(authorizeWorkoutLifecycleMutationHandler(
          earnRequest('evolution:wpi_active:LEVEL_PROMOTION', {
            type: 'LEVEL_PROMOTION', fromLevel: 'BEGINNER', toLevel: 'INTERMEDIATE',
            quality: 'HIGH', sessionsCompletedAtEarn: 30, adherenceAtEarnBp: 10_000,
            qaForced: true, triggerSource: 'QA_TRANSITION',
          }), db,
        )).rejects.toThrow();
      });

      it('QA_ACCELERATED account sending the same QA-shaped earnedFact is denied', async () => {
        await setQaMode('ACCELERATED');
        await expect(authorizeWorkoutLifecycleMutationHandler(
          earnRequest('evolution:wpi_active:LEVEL_PROMOTION', {
            type: 'LEVEL_PROMOTION', fromLevel: 'BEGINNER', toLevel: 'INTERMEDIATE',
            quality: 'HIGH', sessionsCompletedAtEarn: 30, adherenceAtEarnBp: 10_000,
            qaForced: true, triggerSource: 'QA_TRANSITION',
          }), db,
        )).rejects.toThrow();
      });

      it('QA_TRANSITION account: EARN succeeds when the client submits exactly the oracle-derived fact, and the grant carries the QA marker', async () => {
        await setQaMode('TRANSITION');
        const oracle = await authoritativeEarnedFact(UID, db, new Date());
        const idempotencyKey = `evolution:wpi_active:${oracle.type}`;
        const result = await authorizeWorkoutLifecycleMutationHandler(earnRequest(idempotencyKey, oracle), db);
        expect(result.grantId).toBe('current');
        const grant = (await db.collection('users').doc(UID)
          .collection('workoutLifecycleAuthorityGrants').doc('current').get()).data();
        expect(grant?.earnedFact).toMatchObject({ qaForced: true, triggerSource: 'QA_TRANSITION' });
      });

      it('QA_TRANSITION account: client tampering with toLevel (claiming ADVANCED for a BEGINNER account) is rejected', async () => {
        await setQaMode('TRANSITION');
        const oracle = await authoritativeEarnedFact(UID, db, new Date());
        const tampered = { ...oracle, toLevel: 'ADVANCED' };
        const idempotencyKey = `evolution:wpi_active:${oracle.type}`;
        await expect(authorizeWorkoutLifecycleMutationHandler(earnRequest(idempotencyKey, tampered), db))
          .rejects.toMatchObject({ message: 'forged_earned_fact' });
      });

      it('QA_TRANSITION account: client inventing sessionsCompletedAtEarn/adherenceAtEarnBp is rejected', async () => {
        await setQaMode('TRANSITION');
        const oracle = await authoritativeEarnedFact(UID, db, new Date());
        const tampered = { ...oracle, sessionsCompletedAtEarn: 9999, adherenceAtEarnBp: 10_000 };
        const idempotencyKey = `evolution:wpi_active:${oracle.type}`;
        await expect(authorizeWorkoutLifecycleMutationHandler(earnRequest(idempotencyKey, tampered), db))
          .rejects.toMatchObject({ message: 'forged_earned_fact' });
      });

      it('unauthenticated request is denied regardless of QA mode', async () => {
        await setQaMode('TRANSITION');
        const oracle = await authoritativeEarnedFact(UID, db, new Date());
        const idempotencyKey = `evolution:wpi_active:${oracle.type}`;
        await expect(authorizeWorkoutLifecycleMutationHandler({
          auth: undefined,
          data: {
            operation: 'EARN', sourceProgramInstanceId: 'wpi_active', sourceCycleId: 'cyc_active',
            sourcePrescriptionInputSnapshotId: 'pis_active',
            eventType: 'EVOLUTION_EARNED', idempotencyKey,
            eventId: lifecycleEventId('EVOLUTION_EARNED', idempotencyKey),
            earnedFact: oracle,
          },
        } as never, db)).rejects.toThrow();
      });
    });
  });
});
