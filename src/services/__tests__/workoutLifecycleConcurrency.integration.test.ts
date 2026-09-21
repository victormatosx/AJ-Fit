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
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, Timestamp } from 'firebase/firestore';

import { buildSeedDocuments } from '../../../scripts/seedWorkoutTemplates';
import { completeAnswers } from '../../workoutPrescription/__tests__/fixtures';
import { toPersistedAnswers } from '../../lib/questionnaireAnswers';
import { CANONICAL_LIMITATION_DATASET_HASH, CANONICAL_LIMITATION_DATASET_VERSION } from '../../workoutPrescription/limitationDataset';
import { CANONICAL_LIMITATION_PROFILES } from '../../workoutPrescription/limitationDataset';
import { EXERCISES_SEED } from '../../data/exercisesSeedData';

const PROJECT_ID = 'ajfit-rules-test';
const UID = 'gina';
const QUESTIONNAIRE_ID = 'q1';
const enabled = process.env.LIFECYCLE_APPLICATION_INTEGRATION === '1';

let testEnv: RulesTestEnvironment;
const mocks = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock('../../lib/firebase', () => ({ get db() { return mocks.db; } }));

import { generateAndPersistWorkoutProgram } from '../workoutPrograms';
import { lifecycleAt, loadWorkoutLifecycle, listTrainingCycles, listProgramInstances, loadPendingEvolution, listWorkoutLifecycleEvents } from '../workoutLifecycle';
import {
  activatePendingEvolution,
  adaptWorkoutProgram,
  deferPendingEvolution,
  prepareEvolution,
  reconcileWorkoutLifecycle,
} from '../workoutLifecycleApplication';
import { enableWorkoutLifecycleRollout } from './workoutLifecycleRolloutFixture';
import { installWorkoutLifecycleAuthorityFixture, resetWorkoutLifecycleAuthorityFixture } from './workoutLifecycleAuthorityFixture';

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
    await setDoc(doc(rawDb, 'limitationDatasetState', 'active'), {
      datasetVersion: CANONICAL_LIMITATION_DATASET_VERSION,
      limitationDatasetHash: CANONICAL_LIMITATION_DATASET_HASH,
    });
    await setDoc(doc(rawDb, 'users', UID, 'questionnaires', QUESTIONNAIRE_ID), {
      answers: toPersistedAnswers(BEGINNER_ANSWERS), version: 1, createdAt: Timestamp.now(),
    });
    await setDoc(doc(rawDb, 'users', UID, 'workoutProgramState', 'scheduleConfig'), {
      trainingDays: [...TRAINING_DAYS], timezone: 'UTC', scheduleVersion: 1,
    });
  });
}

async function seedCanonicalExerciseCatalog() {
  const profileById = new Map(CANONICAL_LIMITATION_PROFILES.map((item) => [item.exerciseId, item.limitationProfile]));
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const rawDb = ctx.firestore();
    await Promise.all(EXERCISES_SEED.map((exercise) => setDoc(doc(rawDb, 'exercises', exercise.id), JSON.parse(JSON.stringify({
      ...exercise, limitationProfile: profileById.get(exercise.id),
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

  // Phase 10D-V2 (docs/workout-lifecycle/v2/architecture/
  // 25_PHASE_10DV2_LONG_RUN_JOURNEY_CLOSURE.md §28-30 — the "unidentified
  // integration flake" from Phase 10D-V, now reproduced and root-caused):
  // this test's ORIGINAL assertion assumed an earned-but-not-yet-prepared
  // evolution always survives a concurrent ADAPT and simply "re-prepares
  // with the newest safety inputs" against the new instance. That assumption
  // is wrong — active-time/adherence eligibility is scoped to the CURRENT
  // ProgramInstance's own `activatedAt` (confirmed via direct instrumentation:
  // `evaluateProgressionV2ForUser` correctly returns
  // `PROGRESS_CONTINUES/MINIMUM_ACTIVE_TIME_NOT_REACHED` for the brand-new
  // post-ADAPT instance, whose active-day clock legitimately just reset to
  // ~0/1 day). This is the SAME "ADAPT resets program-period progress"
  // contract Phase 10D-V2's VG-I long-run journey independently confirmed as
  // correct, intentional behavior (docs/workout-lifecycle/v2/prescription/
  // 06_PROGRAM_ADAPTATION.md) — just now observed under a race instead of a
  // sequential flow. So when ADAPT's commit is (even partially) visible to
  // PREPARE's retries before PREPARE's own final transaction commits, the
  // CORRECT outcome is that the earned evolution is legitimately lost (the
  // user must re-earn under the new instance) — NOT that it survives and
  // "re-prepares." Both outcomes are legitimate depending on exact
  // interleaving; this test now accepts either, while still asserting the
  // invariants that actually matter: no unhandled rejection, no corruption,
  // and IF a pending evolution does exist, it is correctly scoped to the
  // CURRENT (post-ADAPT) instance with the latest safety inputs — never a
  // stale one bound to the pre-ADAPT instance.
  it('8B Adaptation vs Prepare: no unhandled rejection, no corruption, and any surviving pending is never stale', async () => {
    await seedBaseUser();
    await seedCanonicalExerciseCatalog();
    const generated = await generateAndPersistWorkoutProgram({
      uid: UID, questionnaireId: QUESTIONNAIRE_ID, questionnaireVersion: 1,
      answers: BEGINNER_ANSWERS, source: 'onboarding',
    });
    if (generated.status !== 'SUCCESS') throw new Error('setup failed');
    await backdateCycleWithQualifyingHistory(UID, 30, generated.program.programInstanceId!, generated.program.programId);
    const results = await Promise.allSettled([
      prepareEvolution({ uid: UID }),
      adaptWorkoutProgram({
        uid: UID, updatedFields: { limits: ['knee'] }, reason: 'LIMITATION', idempotencyKey: 'adapt-prepare-knee',
      }),
    ]);
    const raceDiagnostics = results.map((result) => result.status === 'fulfilled'
      ? `fulfilled:${result.value.status}`
      : `rejected:${result.reason instanceof Error ? result.reason.message : String(result.reason)}`);
    expect(results.every((result) => result.status === 'fulfilled'), raceDiagnostics.join(' | ')).toBe(true);
    await reconcileWorkoutLifecycle({ uid: UID });
    const lifecycle = (await loadWorkoutLifecycle(UID))!;
    const pending = await loadPendingEvolution(UID);
    // ADAPT must always win the ProgramInstance itself, regardless of which
    // outcome PREPARE landed on.
    expect(lifecycle.programInstance.prescriptionInputSnapshot?.inputs.limits).toEqual(['knee']);
    expect((await listProgramInstances(UID)).filter((item) => item.supersededAt === null)).toHaveLength(1);
    if (pending) {
      // If a pending evolution survived the race, it must be scoped to the
      // CURRENT instance with the latest safety inputs — never stale.
      expect(pending.sourceProgramInstanceId).toBe(lifecycle.programInstance.programInstanceId);
      expect(pending.targetPrescriptionInputSnapshot?.inputs.limits).toEqual(['knee']);
    }
    // Never more than one EVOLUTION_EARNED event regardless of how many
    // times PREPARE internally retried or recomputed eligibility from scratch.
    expect((await listWorkoutLifecycleEvents(UID)).filter((event) => event.type === 'EVOLUTION_EARNED').length)
      .toBeLessThanOrEqual(1);
  }, 30_000);

  // Phase 10D-V (docs/workout-lifecycle/v2/architecture/
  // 24_PHASE_10DV_VERIFICATION_CLOSURE.md §17-19): a single pass of the race
  // above is not strong evidence either way — it's a timing-dependent race
  // that only manifested under full-integration-suite load in Phase 10D
  // (never reproducible in file isolation). This repeats the exact same
  // ADAPT-vs-PREPARE race N times in a row, each against a freshly seeded
  // account, asserting the acceptable-outcomes contract (§19 of the phase
  // brief) after every single iteration: no unhandled rejection, no
  // corrupted/duplicate lifecycle state, and either a real convergence or an
  // explicit bounded fail-closed/retryable result — never candidate content
  // becoming authoritative and never two active ProgramInstances.
  it('VG stress: Adaptation vs Prepare race repeated N times never corrupts state or unhandled-rejects', async () => {
    const ITERATIONS = 30;
    const outcomes: string[] = [];
    for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
      await testEnv.clearFirestore();
      await enableWorkoutLifecycleRollout(testEnv);
      await seedBaseUser();
      await seedCanonicalExerciseCatalog();
      const generated = await generateAndPersistWorkoutProgram({
        uid: UID, questionnaireId: QUESTIONNAIRE_ID, questionnaireVersion: 1,
        answers: BEGINNER_ANSWERS, source: 'onboarding',
      });
      if (generated.status !== 'SUCCESS') throw new Error(`setup failed at iteration ${iteration}`);
      await backdateCycleWithQualifyingHistory(UID, 30, generated.program.programInstanceId!, generated.program.programId);

      const results = await Promise.allSettled([
        prepareEvolution({ uid: UID }),
        adaptWorkoutProgram({
          uid: UID, updatedFields: { limits: ['knee'] }, reason: 'LIMITATION',
          idempotencyKey: `adapt-prepare-stress-${iteration}`,
        }),
      ]);

      // Acceptable outcomes only (phase brief §19): both calls resolve to
      // SOME typed result (never an unhandled rejection reaching the
      // caller); a bounded fail-closed/retryable typed result is fine.
      const rejected = results.filter((result) => result.status === 'rejected');
      const diagnostics = `iteration ${iteration}: ${results.map((result) => result.status === 'fulfilled'
        ? `fulfilled:${result.value.status}`
        : `rejected:${result.reason instanceof Error ? result.reason.message : String(result.reason)}`).join(' | ')}`;
      outcomes.push(diagnostics);
      expect(rejected, diagnostics).toHaveLength(0);

      // Structural invariants regardless of which outcome won this
      // iteration: exactly one non-superseded ProgramInstance, exactly one
      // active TrainingCycle, and — if a pending evolution exists — it must
      // point at the CURRENT (post-race) instance, never a stale one.
      const activeInstances = (await listProgramInstances(UID)).filter((item) => item.supersededAt === null);
      expect(activeInstances, diagnostics).toHaveLength(1);
      const activeCycles = (await listTrainingCycles(UID)).filter((item) => item.status === 'ACTIVE');
      expect(activeCycles, diagnostics).toHaveLength(1);
      const lifecycle = (await loadWorkoutLifecycle(UID))!;
      const pending = await loadPendingEvolution(UID);
      if (pending) {
        expect(pending.sourceProgramInstanceId, diagnostics).toBe(lifecycle.programInstance.programInstanceId);
      }
      // Never more than one EVOLUTION_EARNED event for this single earned
      // fact, regardless of how many times PREPARE was internally retried.
      const earnedEvents = (await listWorkoutLifecycleEvents(UID)).filter((event) => event.type === 'EVOLUTION_EARNED');
      expect(earnedEvents.length, diagnostics).toBeLessThanOrEqual(1);
    }
    // Surfaced for visibility in test output — not asserted on, since a mix
    // of PREPARED / ALREADY_PENDING / PREPARATION_FAILED outcomes across
    // iterations is itself the expected, acceptable shape of this race.
    // eslint-disable-next-line no-console
    console.log(`Adaptation-vs-Prepare stress (${ITERATIONS} iterations):\n${outcomes.join('\n')}`);
  }, 120_000);

  it('§47/AI Adaptation vs Activation: a concurrent limitation-driven adaptation never lets stale pending content activate', async () => {
    const generated = await seedReadyPending();
    await seedCanonicalExerciseCatalog();
    const beforeRace = Timestamp.now();
    const [adaptResult, startResult] = await Promise.all([
      adaptWorkoutProgram({
        uid: UID, updatedFields: { limits: ['knee'] }, reason: 'LIMITATION',
        idempotencyKey: 'adapt-race-1',
      }),
      activatePendingEvolution({ uid: UID, trigger: 'MANUAL' }),
    ]);
    // Whatever interleaving occurs, the persisted lifecycle must reflect a
    // single coherent active instance — never the stale pending's content
    // layered on top of (or racing against) the safety adaptation.
    const lifecycle = await loadWorkoutLifecycle(UID);
    expect(lifecycle).not.toBeNull();
    const activeInstanceId = lifecycle!.programInstance.programInstanceId;
    const instances = await listProgramInstances(UID);
    const activeCount = instances.filter((i) => i.supersededAt === null).length;
    expect(activeCount).toBe(1);
    expect(instances.find((i) => i.programInstanceId === activeInstanceId)).toBeTruthy();
    expect(lifecycle!.programInstance.prescriptionInputSnapshot?.inputs.limits).toEqual(['knee']);
    // No matter which order applied, the outcome for each call is one of the
    // documented safe statuses — never a thrown, uncategorized error.
    expect(['SUCCESS']).toContain(adaptResult.status);
    expect(['ACTIVATED', 'STALE_PENDING']).toContain(startResult.status);
    const events = await listWorkoutLifecycleEvents(UID);
    expect(events.filter((event) => event.type === 'PROGRAM_ADAPTED')).toHaveLength(1);
    expect(events.filter((event) => event.type === 'LEVEL_PROMOTED').length).toBeLessThanOrEqual(1);

    // The complex race remains reconstructable: immediately before the two
    // commands the original instance was active; afterward history resolves
    // to the single limitation-safe winner rather than rewriting the past.
    expect((await lifecycleAt(UID, beforeRace))?.programInstance.contentIdentity).toBe(generated.program.programId);
    expect((await lifecycleAt(UID, Timestamp.now()))?.programInstance.programInstanceId).toBe(activeInstanceId);
  }, 30_000);
});
