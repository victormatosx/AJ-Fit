import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';

import { authorizeWorkoutLifecycleMutationHandler } from '../authorizeMutation';
import { seedRealPrescriptionCatalog } from './realCatalogFixture';
import { weekdayOfLocalDate } from '../scheduleEngine/calendar';

const enabled = process.env.WORKOUT_LIFECYCLE_AUTHORITY_INTEGRATION === '1';
const UID = 'authority-adversary';

/** Minimal but complete authoritative answers — enough for `selectTemplate`/`generateWorkoutPrescription` to succeed against the real catalog seeded by `seedRealPrescriptionCatalog`. */
function completeInputs(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sex: 'm', goal: 'gain_muscle', level: 'beginner', days: 4, duration: '60', place: 'gym',
    trainingDays: ['MON', 'TUE', 'THU', 'FRI'], equipment: [], style: [], limits: [], muscleFocus: [],
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

  it('rejects activation without an authoritative pending evolution', async () => {
    await expect(authorizeWorkoutLifecycleMutationHandler({
      auth: { uid: UID },
      data: {
        operation: 'ACTIVATE', sourceProgramInstanceId: 'wpi_active', sourceCycleId: 'cyc_active',
        pendingEvolutionId: 'wpe_forged', targetProgramInstanceId: 'wpi_forged',
      },
    } as never, db)).rejects.toMatchObject({ code: 'aborted' });
  });

  it('ADAPT never seals a knee-unsafe exercise even when the declared limitation would have allowed the client to ask for one', async () => {
    // Phase 10B (docs/workout-lifecycle/v2/decisions/
    // ADR-016_BACKEND_AUTHORITATIVE_PRESCRIPTION.md): the backend now
    // generates its OWN plan from the authoritative limitation-bearing
    // inputs against the real catalog — it never seals whatever the client
    // submitted, safe or not. The real proof of safety is checking the
    // SEALED content's real exercise docs, not merely rejecting a client
    // plan (which is not even read for content anymore).
    const inputs = completeInputs({ specialConditions: ['musculoskeletal_limitation'], limits: ['knee'] });
    await db.collection('users').doc(UID).collection('programInstances').doc('wpi_active').update({
      prescriptionInputSnapshot: {
        snapshotId: 'pis_active', schemaVersion: 1, source: 'QUESTIONNAIRE_BASELINE', inputs,
      },
    });
    const targetInputs = { ...inputs, level: 'beginner' };
    const result = await authorizeWorkoutLifecycleMutationHandler({
      auth: { uid: UID },
      data: {
        operation: 'ADAPT', targetProgramSource: 'program_adaptation',
        questionnaireId: 'q1', questionnaireVersion: 1,
        sourceProgramInstanceId: 'wpi_active', sourceCycleId: 'cyc_active',
        sourcePrescriptionInputSnapshotId: 'pis_active', targetProgramInstanceId: 'wpi_unsafe',
        targetContentIdentity: 'wpg_client_claimed_identity', targetPrescriptionIdentity: 'rx_client_claimed_identity',
        targetTrainingLevel: 'BEGINNER', targetCycleNumber: 1,
        updatedFields: {},
        // Structurally valid, in-bounds, "safe-looking" — but irrelevant:
        // the backend never reads this for content.
        targetPlan: {
          planId: 'rx_client_claimed_identity',
          sessions: [{ exercises: [{ exerciseId: 'lat-pulldown', sets: 3 }] }],
        },
        targetPrescriptionInputSnapshot: {
          snapshotId: snapshotIdFor('PROGRAM_ADAPTATION', targetInputs),
          schemaVersion: 1, source: 'PROGRAM_ADAPTATION', inputs: targetInputs,
        },
      },
    } as never, db);
    expect(result).toMatchObject({ grantId: 'current' });
    const grant = (await db.collection('users').doc(UID)
      .collection('workoutLifecycleAuthorityGrants').doc('current').get()).data();
    // The client's claimed identity is never what actually gets sealed.
    expect(grant?.targetContentIdentity).not.toBe('wpg_client_claimed_identity');
    const sealed = await db.collection('users').doc(UID)
      .collection('workoutPrograms').doc(grant!.targetContentIdentity as string).get();
    expect(sealed.exists).toBe(true);
    const sealedExerciseIds = (sealed.data()!.sessions as Array<{ exercises: Array<{ exerciseId: string }> }>)
      .flatMap((session) => session.exercises.map((item) => item.exerciseId));
    expect(sealedExerciseIds.length).toBeGreaterThan(0);
    const exerciseDocs = await db.getAll(...sealedExerciseIds.map((id) => db.collection('exercises').doc(id)));
    for (const document of exerciseDocs) {
      const kneeRule = document.data()?.limitationProfile?.regions?.knee;
      expect(kneeRule?.status).not.toBe('avoid');
    }
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
        operation: 'ADAPT', targetProgramSource: 'program_adaptation',
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
});
