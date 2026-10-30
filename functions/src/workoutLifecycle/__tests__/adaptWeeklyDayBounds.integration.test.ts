import { deleteApp, initializeApp } from 'firebase-admin/app';
import { Timestamp, getFirestore, type Firestore } from 'firebase-admin/firestore';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authorizeWorkoutLifecycleMutationHandler } from '../authorizeMutation';
import { seedRealPrescriptionCatalog } from './realCatalogFixture';
import { buildPrescriptionInputSnapshot, effectivePrescriptionInputsFromAnswers } from '../prescriptionEngine/workoutLifecycle/prescriptionInputs';
import { generateWorkoutPrescriptionRouted } from '../prescriptionEngine/workoutPrescription/generatePrescription';
import { PRESCRIPTION_VERSIONS_V127 } from '../prescriptionEngine/workoutPrescription/types';
import type { CurrentTrainingLevel } from '../prescriptionEngine/workoutLifecycle/types';

/**
 * Drives the REAL `authorizeWorkoutLifecycleMutation` ADAPT against the
 * Firebase Emulator to prove the per-level weekly ceiling is enforced by the
 * AUTHORITY, not just the agenda sheet — and that a rejection leaves the
 * TrainingCycle and the account's active days exactly as they were.
 *
 *   firebase emulators:exec --only auth,firestore,functions --project ajfit-2f321 \
 *     'cd functions && ADAPT_CEILING_INTEGRATION=1 npx vitest run \
 *        src/workoutLifecycle/__tests__/adaptLevelCeiling.integration.test.ts'
 */
const enabled = process.env.ADAPT_CEILING_INTEGRATION === '1';
const WEEK = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const;
const RECOMMENDED = ['MON', 'WED', 'FRI'];
const CYCLE_DAYS = 21;

let app: ReturnType<typeof initializeApp>;
let db: Firestore;

function baseAnswers(level: string, days: number, trainingDays: readonly string[]) {
  return {
    sex: 'm', goal: 'gain_muscle', level, days, trainingDays: [...trainingDays],
    duration: '60', place: 'gym', equipment: [], style: [], muscleFocus: [],
    specialConditions: ['none'], scheduleMode: 'fixed',
    pregnancyScreening: null, postpartumScreening: null, functionalScreening: null,
    lipedemaScreening: null, dizzinessScreening: null, postSurgicalScreening: null,
    medicalRestrictionScreening: null,
  };
}

/** A live 3x v1.27 account at `level`, with 21 days of history and 9 trainings. */
async function seedAccount(uid: string, level: CurrentTrainingLevel) {
  const root = db.collection('users').doc(uid);
  await db.recursiveDelete(root);
  const today = new Date(); today.setUTCHours(12, 0, 0, 0);
  const startMs = today.getTime() - (CYCLE_DAYS - 1) * 86_400_000;
  const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const answers = baseAnswers(level.toLowerCase(), 3, RECOMMENDED);
  const inputs = JSON.parse(JSON.stringify(
    effectivePrescriptionInputsFromAnswers(answers as never, level),
  ));

  await root.set({
    profile: { name: uid, email: `${uid}@ajfit.test` },
    preferences: { language: 'pt-BR', units: 'metric', theme: 'dark' },
    subscription: {},
    metadata: { role: 'user', createdAt: Timestamp.fromMillis(startMs), updatedAt: Timestamp.now() },
  });
  await root.collection('questionnaires').doc('q1').set({
    answers, version: 1, createdAt: Timestamp.fromMillis(startMs),
  });
  await root.collection('workoutLifecycleState').doc('current').set({
    startingLevel: 'BEGINNER', currentTrainingLevel: level,
    currentCycleId: 'cyc_1', currentCycleNumber: 1,
    activeProgramInstanceId: 'wpi_1', activeContentIdentity: 'wpg_1',
    activePrescriptionIdentity: 'rx_1', initializationOrigin: 'V2_NATIVE',
    historyCompleteFrom: Timestamp.fromMillis(startMs), schemaVersion: 2,
    createdAt: Timestamp.fromMillis(startMs), updatedAt: Timestamp.now(),
  });
  await root.collection('trainingCycles').doc('cyc_1').set({
    cycleId: 'cyc_1', level, cycleNumber: 1, status: 'ACTIVE', origin: 'V2_NATIVE',
    programInstanceId: 'wpi_1', previousProgramInstanceId: null,
    progressionReason: 'INITIAL_PROGRAM', completionReason: null,
    startedAt: Timestamp.fromMillis(startMs), eligibleAt: null, completedAt: null,
    schemaVersion: 2, createdAt: Timestamp.fromMillis(startMs), updatedAt: Timestamp.now(),
  });
  await root.collection('workoutProgramState').doc('scheduleConfig').set({
    scheduleMode: 'fixed', trainingDays: RECOMMENDED, activeRecoveryDays: [],
    timezone: 'UTC', scheduleVersion: 1,
  });
  await root.collection('workoutProgramState').doc('active').set({ programId: 'wpg_1' });
  await root.collection('programInstances').doc('wpi_1').set({
    programInstanceId: 'wpi_1', cycleId: 'cyc_1', contentIdentity: 'wpg_1',
    prescriptionIdentity: 'rx_1', questionnaireId: 'q1',
    prescriptionInputSnapshot: {
      snapshotId: 'pis_1', schemaVersion: 1, source: 'QUESTIONNAIRE_BASELINE', inputs,
    },
    activatedAt: Timestamp.fromMillis(startMs), supersededAt: null,
    previousProgramInstanceId: null, activationReason: 'INITIAL_PROGRAM',
    schemaVersion: 2, createdAt: Timestamp.fromMillis(startMs), updatedAt: Timestamp.now(),
  });
  let cursor = 0;
  await root.collection('workoutPrograms').doc('wpg_1').set({
    programId: 'wpg_1', prescriptionId: 'rx_1', questionnaireId: 'q1', questionnaireVersion: 1,
    status: 'active', source: 'onboarding',
    templateId: 'T001', templateVersion: 1,
    templateSourceVersion: PRESCRIPTION_VERSIONS_V127.templateLibrary,
    templateContentHash: 'a'.repeat(64),
    versions: { ...PRESCRIPTION_VERSIONS_V127 },
    scheduleMode: 'fixed', requestedDays: 3, prescribedStructuredDays: 3, prescribedTrainingFrequency: 3,
    availability: { days: 3, weekdays: RECOMMENDED },
    weeklySchedule: WEEK.map((weekday) => (RECOMMENDED.includes(weekday)
      ? { weekday, state: 'TRAINING', sessionIndex: cursor++ }
      : { weekday, state: 'REST' })),
    sessions: Array.from({ length: 3 }, (_, index) => ({
      name: String.fromCharCode(65 + index), type: 'strength',
      displayName: String.fromCharCode(65 + index),
      exercises: [{ exerciseId: 'squat', sourceExerciseId: 'squat', sets: 3, reps: '10', restSeconds: 90 }],
    })),
    createdAt: Timestamp.fromMillis(startMs), updatedAt: Timestamp.now(),
  });

  const trained: number[] = [];
  for (let offset = 0; offset < CYCLE_DAYS; offset += 1) {
    const date = new Date(startMs + offset * 86_400_000);
    const weekday = WEEK[date.getUTCDay() === 0 ? 6 : date.getUTCDay() - 1];
    if (RECOMMENDED.includes(weekday)) trained.push(offset);
  }
  for (const [index, offset] of trained.entries()) {
    const ms = startMs + offset * 86_400_000;
    const date = iso(ms);
    const sessionIndex = index % 3;
    await root.collection('workoutExecutions').doc(`ex_${offset}`).set({
      executionId: `ex_${offset}`, programId: 'wpg_1', programInstanceId: 'wpi_1',
      templateId: 'T001', sessionIndex, sessionName: String.fromCharCode(65 + sessionIndex),
      scheduledLocalDate: date, performedLocalDate: date, status: 'COMPLETED',
      startedAt: Timestamp.fromMillis(ms), finishedAt: Timestamp.fromMillis(ms),
      exercises: [{
        exerciseIndex: 0, exerciseId: 'squat', prescribedSets: 3, prescribedReps: '10',
        prescribedDuration: null, prescribedCycles: null,
        sets: [0, 1, 2].map((setIndex) => ({
          setIndex, status: 'COMPLETED', actualReps: 10, weightKg: 40, actualDurationSeconds: null,
        })),
      }],
      executionSchemaVersion: 2, createdAt: Timestamp.fromMillis(ms), updatedAt: Timestamp.now(),
    });
    await root.collection('workoutPrograms').doc('wpg_1').collection('scheduleEvents')
      .doc(`completed_wpi_1_${sessionIndex}_${date}`).set({
        type: 'COMPLETED', programInstanceId: 'wpi_1', sessionIndex,
        scheduledDate: date, occurredAt: Timestamp.fromMillis(ms),
      });
  }
  return { trainedCount: trained.length };
}

/** The account facts an ADAPT must never disturb. */
async function cycleSnapshot(uid: string) {
  const root = db.collection('users').doc(uid);
  const [state, cycle, executions, instances] = await Promise.all([
    root.collection('workoutLifecycleState').doc('current').get(),
    root.collection('trainingCycles').doc('cyc_1').get(),
    root.collection('workoutExecutions').get(),
    root.collection('programInstances').get(),
  ]);
  return {
    cycleId: state.data()?.currentCycleId,
    cycleNumber: state.data()?.currentCycleNumber,
    level: state.data()?.currentTrainingLevel,
    activeProgramInstanceId: state.data()?.activeProgramInstanceId,
    cycleStartedAtMs: cycle.data()?.startedAt?.toMillis?.() ?? null,
    cycleStatus: cycle.data()?.status,
    activeContentIdentity: state.data()?.activeContentIdentity,
    completedExecutions: executions.size,
    instanceCount: instances.size,
  };
}

/** Exactly what `adaptWorkoutProgram` sends for an agenda frequency change. */
async function adaptRequest(level: CurrentTrainingLevel, days: number) {
  const trainingDays = WEEK.slice(0, days);
  const answers = baseAnswers(level.toLowerCase(), days, trainingDays);
  const snapshot = JSON.parse(JSON.stringify(buildPrescriptionInputSnapshot({
    answers: answers as never, currentTrainingLevel: level, source: 'PROGRAM_ADAPTATION',
  })));
  const generated = generateWorkoutPrescriptionRouted(
    answers as never, level, {}, 'v1.27',
  ) as { status: string; plan?: Record<string, unknown> };
  return {
    operation: 'ADAPT',
    sourceProgramInstanceId: 'wpi_1', sourceCycleId: 'cyc_1',
    sourcePrescriptionInputSnapshotId: 'pis_1',
    targetProgramInstanceId: `wpi_adapt_${days}`, targetCycleId: 'cyc_1',
    targetContentIdentity: `wpg_adapt_${days}`,
    targetPrescriptionIdentity: String(generated.plan?.planId ?? `rx_adapt_${days}`),
    targetTrainingLevel: level, targetCycleNumber: 1,
    questionnaireId: 'q1', questionnaireVersion: 1,
    targetProgramSource: 'program_adaptation',
    targetTemplateVersion: 1,
    targetTemplateSourceVersion: PRESCRIPTION_VERSIONS_V127.templateLibrary,
    targetTemplateContentHash: 'a'.repeat(64),
    updatedFields: { days, scheduleMode: 'fixed', trainingDays: [...trainingDays] },
    targetPlan: generated.plan,
    targetPrescriptionInputSnapshot: snapshot,
    eventType: 'PROGRAM_ADAPTED',
  };
}

async function runAdapt(uid: string, level: CurrentTrainingLevel, days: number) {
  try {
    const result = await authorizeWorkoutLifecycleMutationHandler(
      { auth: { uid }, data: await adaptRequest(level, days) } as never, db,
    );
    return { ok: true as const, result };
  } catch (error) {
    return {
      ok: false as const,
      code: (error as { code?: string }).code,
      message: (error as Error).message,
    };
  }
}

describe.skipIf(!enabled)('ADAPT — per-level weekly bounds are enforced by the authority', () => {
  beforeAll(async () => {
    app = initializeApp({ projectId: 'ajfit-2f321' }, 'adapt-ceiling');
    db = getFirestore(app);
    await seedRealPrescriptionCatalog(db);
  }, 180_000);
  afterAll(async () => { await deleteApp(app); });

  const CEILING: Record<CurrentTrainingLevel, number> = {
    BEGINNER: 3, INTERMEDIATE: 6, ADVANCED: 6,
  };

  it.each(['BEGINNER', 'INTERMEDIATE', 'ADVANCED'] as const)(
    '%s: refuses everything above its ceiling, with cycle and active days intact',
    async (level) => {
      for (const days of [CEILING[level] + 1, 7]) {
        const uid = `zz-bounds-${level.toLowerCase()}-${days}`;
        await seedAccount(uid, level);
        const before = await cycleSnapshot(uid);
        const outcome = await runAdapt(uid, level, days);
        expect(outcome.ok, `${level} deveria recusar ${days} dias`).toBe(false);
        if (outcome.ok) continue;
        expect(outcome.message).toContain('weekly_days_outside_level_bounds');
        expect(await cycleSnapshot(uid)).toEqual(before);
      }
    },
    180_000,
  );

  it.each(['BEGINNER', 'INTERMEDIATE', 'ADVANCED'] as const)(
    '%s: refuses a single-day schedule (below the floor)',
    async (level) => {
      const uid = `zz-floor-${level.toLowerCase()}`;
      await seedAccount(uid, level);
      const before = await cycleSnapshot(uid);
      const outcome = await runAdapt(uid, level, 1);
      expect(outcome.ok).toBe(false);
      if (outcome.ok) return;
      expect(outcome.message).toContain('weekly_days_outside_level_bounds');
      expect(await cycleSnapshot(uid)).toEqual(before);
    },
    180_000,
  );

  it.each(['BEGINNER', 'INTERMEDIATE', 'ADVANCED'] as const)(
    '%s: accepts every count inside its range, preserving cycle and active days',
    async (level) => {
      for (let days = 2; days <= CEILING[level]; days += 1) {
        if (days === 3) continue; // same frequency as the seed: not an ADAPT
        const uid = `zz-ok-${level.toLowerCase()}-${days}`;
        await seedAccount(uid, level);
        const before = await cycleSnapshot(uid);
        const outcome = await runAdapt(uid, level, days);
        expect(outcome.ok, `${level} deveria aceitar ${days} dias`).toBe(true);
        if (!outcome.ok) continue;
        const after = await cycleSnapshot(uid);
        expect(after.cycleId).toBe(before.cycleId);
        expect(after.cycleNumber).toBe(before.cycleNumber);
        expect(after.cycleStartedAtMs).toBe(before.cycleStartedAtMs);
        expect(after.completedExecutions).toBe(before.completedExecutions);
        expect(after.instanceCount).toBe(before.instanceCount + 1);
        const program = (await db.collection('users').doc(uid)
          .collection('workoutPrograms').doc(String(after.activeContentIdentity)).get()).data();
        // THE invariant the bounds exist to guarantee.
        expect(program?.requestedDays).toBe(days);
        expect(program?.prescribedTrainingFrequency).toBe(days);
        expect((program?.weeklySchedule as { state: string }[])
          .filter((entry) => entry.state === 'TRAINING')).toHaveLength(days);
      }
    },
    180_000,
  );
});
