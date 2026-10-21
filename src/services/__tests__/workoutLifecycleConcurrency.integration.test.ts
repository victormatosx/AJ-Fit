/**
 * Fase 6 — dedicated concurrency/race suite for the Lifecycle Orchestrator
 * (docs architecture/12_PHASE_6_IMPLEMENTATION.md §35/§105). Reuses the same
 * emulator fixture pattern as workoutLifecycleApplication.integration.test.ts
 * but is scoped purely to races the Fase 4 report left untested: Defer/Defer,
 * Start/Defer, Manual vs Auto activation, and Adaptation vs Activation.
 *
 * Guarantee under test is "exactly one effective domain transition", not
 * "only one request succeeds" — both calls may return success, but the
 * persisted state must never show two cycles, two instances, two consumed
 * deferrals, or a corrupted pending doc.
 */
import { initializeTestEnvironment,type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { Timestamp,doc,getDoc,setDoc } from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll,beforeAll,beforeEach,describe,expect,it,vi } from 'vitest';

import { buildSeedDocuments } from '../../../scripts/seedWorkoutTemplates';
import { EXERCISES_SEED } from '../../data/exercisesSeedData';
import { toPersistedAnswers } from '../../lib/questionnaireAnswers';
import { completeAnswers } from '../../workoutPrescription/__tests__/fixtures';

const PROJECT_ID = 'ajfit-rules-test';
const UID = 'gina';
const QUESTIONNAIRE_ID = 'q1';
const enabled = process.env.LIFECYCLE_APPLICATION_INTEGRATION === '1';

let testEnv: RulesTestEnvironment;
const mocks = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock('../../lib/firebase', () => ({ get db() { return mocks.db; } }));

import { listProgramInstances,listTrainingCycles,listWorkoutLifecycleEvents,loadPendingEvolution,loadWorkoutLifecycle } from '../workoutLifecycle';
import {
  activatePendingEvolution,
  deferPendingEvolution,
  prepareEvolution,
  reconcileWorkoutLifecycle
} from '../workoutLifecycleApplication';
import { generateAndPersistWorkoutProgram } from '../workoutPrograms';
import { installWorkoutLifecycleAuthorityFixture,resetWorkoutLifecycleAuthorityFixture } from './workoutLifecycleAuthorityFixture';
import { enableWorkoutLifecycleRollout } from './workoutLifecycleRolloutFixture';

const T003_SEED = buildSeedDocuments().find((t) => t.id === 'T003');
if (!T003_SEED) throw new Error('T003 fixture missing from catalog — cannot run this integration test');

const TRAINING_DAYS = ['MON', 'TUE', 'THU', 'FRI'] as const;

const BEGINNER_ANSWERS = completeAnswers({
  sex: 'm', goal: 'gain_muscle', level: 'beginner', days: 4, trainingDays: [...TRAINING_DAYS], place: 'gym', specialConditions: ['none'],
});
const MS_PER_DAY = 24 * 60 * 60 * 1000;

async function seedBaseUser() {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const rawDb = ctx.firestore();
    await setDoc(doc(rawDb, 'users', UID), {
      profile: { name: 'Gina', email: 'gina@example.com' },
      preferences: { language: 'pt-BR', units: 'system', theme: 'dark' },
      subscription: {},
      metadata: { role: 'user', createdAt: Timestamp.now(), updatedAt: Timestamp.now(), commercialGateResolvedAt: Timestamp.now() },
    });
    await setDoc(doc(rawDb, 'workoutTemplates', 'T003'), T003_SEED);
    await setDoc(doc(rawDb, 'users', UID, 'questionnaires', QUESTIONNAIRE_ID), {
      answers: toPersistedAnswers(BEGINNER_ANSWERS), version: 1, createdAt: Timestamp.now(),
    });
    await setDoc(doc(rawDb, 'users', UID, 'workoutProgramState', 'scheduleConfig'), {
      trainingDays: [...TRAINING_DAYS], timezone: 'UTC', scheduleVersion: 1,
    });
  });
}

async function seedCanonicalExerciseCatalog() {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const rawDb = ctx.firestore();
    await Promise.all(EXERCISES_SEED.map((exercise) => setDoc(doc(rawDb, 'exercises', exercise.id), JSON.parse(JSON.stringify({
      ...exercise,
    })))));
  });
}

function isTrainingWeekday(date: Date): boolean {
  const map = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  return (TRAINING_DAYS as readonly string[]).includes(map[date.getUTCDay()]);
}

async function backdateCycleWithQualifyingHistory(uid: string, activeDaysAgo: number, programInstanceId: string, programId: string) {
  const cycleId = (await loadWorkoutLifecycle(uid))!.lifecycle.currentCycleId;
  const programSnapshot = await getDoc(doc(mocks.db as never, 'users', uid, 'workoutPrograms', programId));
  const program = programSnapshot.data() as {
    sessions: Array<{ exercises: Array<{ exerciseId: string; sets?: number }> }>;
  };
  const start = new Date(Date.now() - activeDaysAgo * MS_PER_DAY);
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const rawDb = ctx.firestore();
    await setDoc(doc(rawDb, 'users', uid, 'trainingCycles', cycleId), { startedAt: Timestamp.fromDate(start) }, { merge: true });
    await setDoc(doc(rawDb, 'users', uid, 'programInstances', programInstanceId), { activatedAt: Timestamp.fromDate(start) }, { merge: true });
    let cursor = new Date(start);
    let index = 0;
    while (cursor.getTime() <= Date.now()) {
      if (isTrainingWeekday(cursor)) {
        const scheduledLocalDate = cursor.toISOString().slice(0, 10);
        const sessionIndex = index % program.sessions.length;
        const exercises = program.sessions[sessionIndex].exercises.map((exercise, exerciseIndex) => ({
          exerciseIndex,
          exerciseId: exercise.exerciseId,
          sets: Array.from({ length: exercise.sets ?? 1 }, (_, setIndex) => ({
            setIndex, status: 'COMPLETED' as const,
          })),
        }));
        await setDoc(doc(rawDb, 'users', uid, 'workoutExecutions', `exec_${programInstanceId}_${index}_${scheduledLocalDate}`), {
          programId, programInstanceId, templateId: 'T003', sessionIndex, sessionName: 'A',
          scheduledLocalDate, status: 'COMPLETED', startedAt: Timestamp.now(), finishedAt: Timestamp.now(),
          exercises, executionSchemaVersion: 2, createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
        });
        await setDoc(doc(rawDb, 'users', uid, 'workoutPrograms', programId, 'scheduleEvents', `completed_${programInstanceId}_${index}_${scheduledLocalDate}`), {
          type: 'COMPLETED', programInstanceId, sessionIndex,
          scheduledDate: scheduledLocalDate, occurredAt: Timestamp.now(),
        });
        index += 1;
      }
      cursor = new Date(cursor.getTime() + MS_PER_DAY);
    }
  });
}

async function seedReadyPending() {
  await seedBaseUser();
  const generated = await generateAndPersistWorkoutProgram({
    uid: UID, questionnaireId: QUESTIONNAIRE_ID, questionnaireVersion: 1, answers: BEGINNER_ANSWERS, source: 'onboarding',
  });
  if (generated.status !== 'SUCCESS') throw new Error('setup failed');
  await backdateCycleWithQualifyingHistory(UID, 30, generated.program.programInstanceId!, generated.program.programId);
  const prepared = await prepareEvolution({ uid: UID });
  if (prepared.status !== 'PREPARED') throw new Error('setup failed: ' + prepared.status);
  return generated;
}

describe.skipIf(!enabled)('Fase 6 — Lifecycle concurrency races (real Firestore Emulator)', () => {
  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: { rules: readFileSync(resolve(__dirname, '../../../firestore.rules'), 'utf8') },
    });
    mocks.db = testEnv.authenticatedContext(UID, { email: 'gina@example.com', email_verified: true }).firestore();
    installWorkoutLifecycleAuthorityFixture(testEnv, UID);
  });
  afterAll(async () => {
    resetWorkoutLifecycleAuthorityFixture();
    await testEnv.cleanup();
  });
  beforeEach(async () => {
    await testEnv.clearFirestore();
    await enableWorkoutLifecycleRollout(testEnv);
  });

  it('8B Prepare vs Prepare / simultaneous progression converges on one earned fact and one target', async () => {
    await seedBaseUser();
    const generated = await generateAndPersistWorkoutProgram({
      uid: UID, questionnaireId: QUESTIONNAIRE_ID, questionnaireVersion: 1,
      answers: BEGINNER_ANSWERS, source: 'onboarding',
    });
    if (generated.status !== 'SUCCESS') throw new Error('setup failed');
    await backdateCycleWithQualifyingHistory(UID, 30, generated.program.programInstanceId!, generated.program.programId);
    const [a, b] = await Promise.all([prepareEvolution({ uid: UID }), prepareEvolution({ uid: UID })]);
    expect(['PREPARED', 'ALREADY_PENDING']).toContain(a.status);
    expect(['PREPARED', 'ALREADY_PENDING']).toContain(b.status);
    expect(await loadPendingEvolution(UID)).not.toBeNull();
    const events = await listWorkoutLifecycleEvents(UID);
    expect(events.filter((event) => event.type === 'EVOLUTION_EARNED')).toHaveLength(1);
    expect(await listProgramInstances(UID)).toHaveLength(1); // target is not active/persisted early
  }, 30_000);

  it('§44/AE Defer vs Defer: two concurrent calls consume exactly one deferral, never two', async () => {
    await seedReadyPending();
    const [a, b] = await Promise.all([
      deferPendingEvolution({ uid: UID }),
      deferPendingEvolution({ uid: UID }),
    ]);
    const results = [a, b];
    const deferred = results.filter((r) => r.status === 'DEFERRED');
    const rejected = results.filter((r) => r.status === 'CANNOT_DEFER');
    // Either both converge on the same single increment (idempotent retry) or
    // exactly one wins and the other is correctly refused — never both winning
    // with independent increments.
    expect(deferred.length).toBeGreaterThanOrEqual(1);
    expect(deferred.length + rejected.length).toBe(2);
    const pending = await loadPendingEvolution(UID);
    expect(pending!.deferralCount).toBe(1);
    expect((await listWorkoutLifecycleEvents(UID)).filter((event) => event.type === 'EVOLUTION_DEFERRED')).toHaveLength(1);
  }, 30_000);

  it('§42/AD Start vs Defer: concurrent activation and deferral resolve to one safe final state', async () => {
    await seedReadyPending();
    const [startResult, deferResult] = await Promise.all([
      activatePendingEvolution({ uid: UID, trigger: 'MANUAL' }),
      deferPendingEvolution({ uid: UID }),
    ]);
    // Whichever "wins", the final state must be internally consistent: if
    // activation applied, the pending doc must be gone (never left half-deferred
    // half-active); if activation did not apply, defer's own result must be valid.
    expect(['ACTIVATED']).toContain(startResult.status);
    const pendingAfter = await loadPendingEvolution(UID);
    if (deferResult.status === 'DEFERRED') {
      // Defer's transaction observed the pending doc before Start's delete —
      // Start must still have cleanly activated afterward, clearing it.
      expect(pendingAfter).toBeNull();
    } else {
      expect(deferResult.status).toBe('NO_PENDING_EVOLUTION');
      expect(pendingAfter).toBeNull();
    }
    expect(await listTrainingCycles(UID)).toHaveLength(2);
    expect(await listProgramInstances(UID)).toHaveLength(2);
    const events = await listWorkoutLifecycleEvents(UID);
    expect(events.filter((event) => event.type === 'LEVEL_PROMOTED')).toHaveLength(1);
    expect(events.filter((event) => event.type === 'EVOLUTION_DEFERRED').length).toBeLessThanOrEqual(1);
  }, 30_000);

  it('§43/AF Manual vs Auto activation race converges on exactly one effective activation', async () => {
    await seedReadyPending();
    // Defer twice to reach the auto-activation deadline, mirroring the E2E flow.
    const d0 = new Date();
    const first = await deferPendingEvolution({ uid: UID, now: d0 });
    if (first.status !== 'DEFERRED') throw new Error('setup failed');
    const d14 = new Date(d0.getTime() + 14 * MS_PER_DAY);
    const second = await deferPendingEvolution({ uid: UID, now: d14 });
    if (second.status !== 'DEFERRED') throw new Error('setup failed');
    const dueAt = new Date(d14.getTime() + 14 * MS_PER_DAY + MS_PER_DAY);

    const [manual, auto] = await Promise.all([
      activatePendingEvolution({ uid: UID, trigger: 'MANUAL', now: dueAt }),
      activatePendingEvolution({ uid: UID, trigger: 'AUTO', now: dueAt }),
    ]);
    expect(manual.status).toBe('ACTIVATED');
    expect(auto.status).toBe('ACTIVATED');
    if (manual.status !== 'ACTIVATED' || auto.status !== 'ACTIVATED') return;
    expect(manual.program.programInstanceId).toBe(auto.program.programInstanceId);
    expect(await listTrainingCycles(UID)).toHaveLength(2);
    expect(await listProgramInstances(UID)).toHaveLength(2);
    expect(await loadPendingEvolution(UID)).toBeNull();
    expect((await listWorkoutLifecycleEvents(UID)).filter((event) => event.type === 'LEVEL_PROMOTED')).toHaveLength(1);
  }, 30_000);

  // Phase 10D-V VG-G2 (docs/workout-lifecycle/v2/architecture/
  // 22_POST_PHASE_10C_FINAL_ADVERSARIAL_AUDIT.md §34/§77; phase brief's
  // G2): distinct from "Manual vs Auto" above — here the SAME deadline-
  // triggered auto-activation path races an explicit user-initiated Defer,
  // both hitting the pending doc at once at exactly the auto-activation
  // deadline.
  it('VG-G2 Defer vs Auto-Activate: concurrent defer and deadline auto-activation resolve to one safe final state', async () => {
    await seedReadyPending();
    const d0 = new Date();
    const first = await deferPendingEvolution({ uid: UID, now: d0 });
    if (first.status !== 'DEFERRED') throw new Error('setup failed');
    const d14 = new Date(d0.getTime() + 14 * MS_PER_DAY);
    const second = await deferPendingEvolution({ uid: UID, now: d14 });
    if (second.status !== 'DEFERRED') throw new Error('setup failed');
    const dueAt = new Date(d14.getTime() + 14 * MS_PER_DAY + MS_PER_DAY);

    const [deferResult, autoResult] = await Promise.all([
      deferPendingEvolution({ uid: UID, now: dueAt }),
      activatePendingEvolution({ uid: UID, trigger: 'AUTO', now: dueAt }),
    ]);
    // Whichever wins, the final state must be internally consistent — never
    // both a third deferral AND an auto-activation both landing, never two
    // active ProgramInstances, never a doubled semantic event.
    const pendingAfter = await loadPendingEvolution(UID);
    if (autoResult.status === 'ACTIVATED') {
      expect(pendingAfter).toBeNull();
      expect(['DEFERRED', 'CANNOT_DEFER', 'NO_PENDING_EVOLUTION']).toContain(deferResult.status);
    } else {
      // Auto-activation lost the race to a legitimate third defer — the
      // pending must still exist, now carrying exactly one more deferral,
      // and auto's own result must say so rather than silently no-op.
      expect(deferResult.status).toBe('DEFERRED');
      expect(pendingAfter).not.toBeNull();
      expect(pendingAfter!.deferralCount).toBe(3);
      expect(['NOT_DUE', 'STALE_PENDING', 'NO_PENDING_EVOLUTION']).toContain(autoResult.status);
    }
    expect(await listTrainingCycles(UID)).toHaveLength(pendingAfter ? 1 : 2);
    expect(await listProgramInstances(UID)).toHaveLength(pendingAfter ? 1 : 2);
    const events = await listWorkoutLifecycleEvents(UID);
    expect(events.filter((event) => event.type === 'LEVEL_PROMOTED').length).toBeLessThanOrEqual(1);
    expect(events.filter((event) => event.type === 'EVOLUTION_DEFERRED').length).toBeLessThanOrEqual(3);
  }, 30_000);

  it('8B Auto vs Auto cold-start reconciliation converges on one activation event', async () => {
    await seedReadyPending();
    const d0 = new Date();
    await deferPendingEvolution({ uid: UID, now: d0 });
    const d14 = new Date(d0.getTime() + 14 * MS_PER_DAY);
    await deferPendingEvolution({ uid: UID, now: d14 });
    const due = new Date(d14.getTime() + 15 * MS_PER_DAY);
    const [a, b] = await Promise.all([
      reconcileWorkoutLifecycle({ uid: UID, now: due }),
      reconcileWorkoutLifecycle({ uid: UID, now: due }),
    ]);
    expect(a.autoActivated || b.autoActivated).toBe(true);
    expect(await loadPendingEvolution(UID)).toBeNull();
    const events = await listWorkoutLifecycleEvents(UID);
    expect(events.filter((event) => event.type === 'LEVEL_PROMOTED')).toHaveLength(1);
    expect((await listProgramInstances(UID)).filter((item) => item.supersededAt === null)).toHaveLength(1);
  }, 30_000);
});
