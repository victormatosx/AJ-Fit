import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

import { installActiveWorkoutProgramHandler } from '../installActiveWorkoutProgram';
import { ACCOUNT_DELETION_LOCKS_COLLECTION } from '../../accountDeletion/repository';
import { seedRealPrescriptionCatalog } from './realCatalogFixture';

/**
 * Fase 2.8 — real Firestore Emulator coverage for `installActiveWorkoutProgram`,
 * the Admin SDK Cloud Function that installs a brand-new account's first
 * active workout program entirely server-side (see that file's doc comment
 * for the full trust-boundary rationale). Mirrors the exact
 * `authorizeMutation.integration.test.ts` pattern: calls the handler
 * directly against a real (Admin SDK) Firestore emulator instance, so
 * `firestore.runTransaction` and every guard run for real.
 *
 * Skipped by default — only runs when
 * `INSTALL_ACTIVE_WORKOUT_PROGRAM_INTEGRATION=1` is set (see the
 * `test:integration:installActiveWorkoutProgram` npm script).
 */

const enabled = process.env.INSTALL_ACTIVE_WORKOUT_PROGRAM_INTEGRATION === '1';
const UID = 'install-adversary';

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

function snapshotIdFor(source: string, inputs: Record<string, unknown>): string {
  let hash = 0x811c9dc5;
  const identity = canonical({ schemaVersion: 1, source, inputs });
  for (let index = 0; index < identity.length; index += 1) {
    hash ^= identity.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `pis_${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function installRequest(overrides: Record<string, unknown> = {}) {
  const inputs = completeInputs();
  return {
    questionnaireId: 'q1',
    questionnaireVersion: 1,
    targetPrescriptionInputSnapshot: {
      snapshotId: snapshotIdFor('QUESTIONNAIRE_BASELINE', inputs),
      schemaVersion: 1, source: 'QUESTIONNAIRE_BASELINE', inputs,
    },
    source: 'onboarding',
    ...overrides,
  };
}

describe.skipIf(!enabled)('installActiveWorkoutProgram — real Firestore Emulator', () => {
  let app: App;
  let db: Firestore;

  beforeAll(async () => {
    app = initializeApp({ projectId: 'ajfit-rules-test' }, 'install-active-workout-program-integration');
    db = getFirestore(app);
    await seedRealPrescriptionCatalog(db);
  });

  afterAll(async () => deleteApp(app));

  beforeEach(async () => {
    await db.recursiveDelete(db.collection('users').doc(UID));
    await db.collection('accountDeletionLocks').doc(UID).delete();
    await db.collection('users').doc(UID).collection('questionnaires').doc('q1').set({
      answers: completeInputs(),
      version: 1,
    });
  });

  it('requires Firebase Auth — never trusts a client-supplied uid', async () => {
    await expect(installActiveWorkoutProgramHandler(
      { auth: null, data: installRequest() } as never,
      db,
    )).rejects.toMatchObject({ code: 'unauthenticated' });
    expect((await db.collection('users').doc(UID).collection('workoutPrograms').get()).size).toBe(0);
  });

  it('rejects an account with a pending account-deletion lock, before touching any lifecycle state', async () => {
    await db.collection(ACCOUNT_DELETION_LOCKS_COLLECTION).doc(UID).set({ status: 'REQUESTED' });
    await expect(installActiveWorkoutProgramHandler(
      { auth: { uid: UID }, data: installRequest() } as never,
      db,
    )).rejects.toMatchObject({ code: 'failed-precondition' });
    expect((await db.collection('users').doc(UID).collection('workoutPrograms').get()).size).toBe(0);
  });

  it('rejects a malformed request before any read/write', async () => {
    await expect(installActiveWorkoutProgramHandler(
      { auth: { uid: UID }, data: { questionnaireId: 123, questionnaireVersion: 1, targetPrescriptionInputSnapshot: {}, source: 'onboarding' } } as never,
      db,
    )).rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(installActiveWorkoutProgramHandler(
      { auth: { uid: UID }, data: { ...installRequest(), source: 'evolution_activation' } } as never,
      db,
    )).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('installs a brand-new account\'s first program end to end, with every document schema-coherent', async () => {
    const result = await installActiveWorkoutProgramHandler(
      { auth: { uid: UID }, data: installRequest() } as never,
      db,
    );
    expect(result.status).toBe('installed');

    const root = db.collection('users').doc(UID);
    const [program, cycle, instance, lifecycle, state, events] = await Promise.all([
      root.collection('workoutPrograms').doc(result.programId).get(),
      root.collection('trainingCycles').get(),
      root.collection('programInstances').doc(result.programInstanceId).get(),
      root.collection('workoutLifecycleState').doc('current').get(),
      root.collection('workoutProgramState').doc('active').get(),
      root.collection('workoutLifecycleEvents').get(),
    ]);

    expect(program.exists).toBe(true);
    expect(program.data()?.status).toBe('active');
    expect(program.data()?.source).toBe('onboarding');

    expect(cycle.size).toBe(1);
    expect(cycle.docs[0].data()).toMatchObject({
      status: 'ACTIVE', cycleNumber: 1, origin: 'V2_NATIVE', programInstanceId: result.programInstanceId,
    });

    expect(instance.exists).toBe(true);
    expect(instance.data()).toMatchObject({
      contentIdentity: result.programId,
      cycleId: cycle.docs[0].id,
      activationReason: 'INITIAL_PROGRAM',
    });

    expect(lifecycle.exists).toBe(true);
    expect(lifecycle.data()).toMatchObject({
      activeContentIdentity: result.programId,
      activeProgramInstanceId: result.programInstanceId,
      currentCycleId: cycle.docs[0].id,
      currentCycleNumber: 1,
      initializationOrigin: 'V2_NATIVE',
    });

    expect(state.exists).toBe(true);
    expect(state.data()).toMatchObject({ programId: result.programId, programInstanceId: result.programInstanceId });

    expect(events.size).toBe(1);
    expect(events.docs[0].data()).toMatchObject({ type: 'PROGRAM_STARTED', programInstanceId: result.programInstanceId });
  });

  it('is idempotent: a retried call for an already-installed account returns already_active and creates nothing new', async () => {
    const first = await installActiveWorkoutProgramHandler(
      { auth: { uid: UID }, data: installRequest() } as never,
      db,
    );
    expect(first.status).toBe('installed');

    const second = await installActiveWorkoutProgramHandler(
      { auth: { uid: UID }, data: installRequest() } as never,
      db,
    );
    expect(second).toEqual({ status: 'already_active', programId: first.programId, programInstanceId: first.programInstanceId });

    const root = db.collection('users').doc(UID);
    const [programs, instances, cycles, events] = await Promise.all([
      root.collection('workoutPrograms').get(),
      root.collection('programInstances').get(),
      root.collection('trainingCycles').get(),
      root.collection('workoutLifecycleEvents').get(),
    ]);
    expect(programs.size).toBe(1);
    expect(instances.size).toBe(1);
    expect(cycles.size).toBe(1);
    expect(events.size).toBe(1);
  });

  it('two truly concurrent calls for the same uid converge on exactly one installed program, never two', async () => {
    const [a, b] = await Promise.all([
      installActiveWorkoutProgramHandler({ auth: { uid: UID }, data: installRequest() } as never, db),
      installActiveWorkoutProgramHandler({ auth: { uid: UID }, data: installRequest() } as never, db),
    ]);
    expect(a.programId).toBe(b.programId);
    expect(a.programInstanceId).toBe(b.programInstanceId);
    // INITIALIZE content is fully deterministic (same questionnaire, same
    // catalogs) — both calls independently compute the SAME canonical
    // `programId`, so both legitimately observe `finalData.activeContentIdentity
    // === programId` and report `installed`, regardless of which one actually
    // won the transaction (only distinguishable via the "committed" vs
    // "already_active_transaction_race" log line, not the public result).
    // The real, load-bearing convergence guarantee is checked below: exactly
    // one of everything was ever persisted.
    expect(a.status).toBe('installed');
    expect(b.status).toBe('installed');

    const root = db.collection('users').doc(UID);
    const [programs, instances, cycles, lifecycle] = await Promise.all([
      root.collection('workoutPrograms').get(),
      root.collection('programInstances').get(),
      root.collection('trainingCycles').get(),
      root.collection('workoutLifecycleState').doc('current').get(),
    ]);
    expect(programs.size).toBe(1);
    expect(instances.size).toBe(1);
    expect(cycles.size).toBe(1);
    expect(lifecycle.data()?.activeContentIdentity).toBe(a.programId);
  });

  it('never trusts a client-supplied questionnaire answer — regenerates the plan AND the training level from the server-side questionnaire document', async () => {
    // The client's own `targetPrescriptionInputSnapshot.inputs` intentionally
    // disagrees with the authoritative Firestore questionnaire (different
    // experience level) — both the persisted PLAN CONTENT (`generateCanonicalPlan`
    // reads `answers` loaded from Firestore, never the client snapshot —
    // authorizeMutation.ts:831) AND `currentTrainingLevel` (Fase 2.9 —
    // `levelFromAnswers(answers)`, replacing the old client-snapshot-sourced
    // `levelFromSnapshot`) must reflect the AUTHORITATIVE document.
    await db.collection('users').doc(UID).collection('questionnaires').doc('q1').set({
      answers: completeInputs({ level: 'advanced' }),
      version: 1,
    });
    const spoofedInputs = completeInputs({ level: 'beginner' });
    const result = await installActiveWorkoutProgramHandler(
      {
        auth: { uid: UID },
        data: {
          questionnaireId: 'q1',
          questionnaireVersion: 1,
          targetPrescriptionInputSnapshot: {
            snapshotId: snapshotIdFor('QUESTIONNAIRE_BASELINE', spoofedInputs),
            schemaVersion: 1, source: 'QUESTIONNAIRE_BASELINE', inputs: spoofedInputs,
          },
          source: 'onboarding',
        },
      } as never,
      db,
    );
    expect(result.status).toBe('installed');
    const program = await db.collection('users').doc(UID).collection('workoutPrograms').doc(result.programId).get();
    // v1.27 (the authoritative default for a brand-new lifecycle —
    // resolveAuthoritativeGenerationVersionForNewLifecycle) never reshapes a
    // template with legacy `experience:*` modifiers post-selection
    // (engineV127.ts's own file doc): level instead drives WHICH template
    // `selectBaseTemplateV127` picks in the first place, recorded as a
    // `beginner_route:*` marker on `trace.selectionReasons` — the one trace
    // field both the v1.27 and v2 engines populate under the same name.
    expect(program.data()?.trace?.selectionReasons).toContain('beginner_route:false');
    expect(program.data()?.trace?.selectionReasons).not.toContain('beginner_route:true');

    const lifecycle = await db.collection('users').doc(UID).collection('workoutLifecycleState').doc('current').get();
    expect(lifecycle.data()?.currentTrainingLevel).toBe('ADVANCED');
    expect(lifecycle.data()?.startingLevel).toBe('ADVANCED');
    const cycle = await db.collection('users').doc(UID).collection('trainingCycles').get();
    expect(cycle.docs[0].data().level).toBe('ADVANCED');
  });

  it('accepts a real "never trained before" onboarding answer as BEGINNER (levelFromAnswers alias coverage)', async () => {
    // Fase 2.9 regression guard: the OLD `levelFromSnapshot` only accepted
    // the three canonical strings and would have rejected this real
    // onboarding option (`src/onboarding/questionDefs.ts`) with
    // `target_snapshot_level_invalid`.
    await db.collection('users').doc(UID).collection('questionnaires').doc('q1').set({
      answers: completeInputs({ level: 'never_or_starting' }),
      version: 1,
    });
    const result = await installActiveWorkoutProgramHandler(
      { auth: { uid: UID }, data: installRequest() } as never,
      db,
    );
    expect(result.status).toBe('installed');
    const lifecycle = await db.collection('users').doc(UID).collection('workoutLifecycleState').doc('current').get();
    expect(lifecycle.data()?.currentTrainingLevel).toBe('BEGINNER');
  });
});
