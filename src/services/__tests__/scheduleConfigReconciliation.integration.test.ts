/**
 * OPT-IN integration proof against the REAL Firestore Emulator — same
 * pattern as `workoutProgramReconciliation.integration.test.ts`. Proves
 * Phase 1 Part B (`ensureScheduleConfigFromQuestionnaire` bridging the
 * questionnaire's `trainingDays` into the Schedule Engine automatically)
 * end to end through the real `resolveWorkoutSchedule` resolver and real
 * `startOrResumeWorkoutExecution`, against the REAL (already-published)
 * Firestore Rules — not just mocks.
 *
 * Skipped by default — only runs when `SCHEDULE_CONFIG_RECONCILIATION_INTEGRATION=1`
 * is set (see the `test:integration:scheduleConfigReconciliation` npm script).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, setDoc, Timestamp } from 'firebase/firestore';

import { buildSeedDocuments } from '../../../scripts/seedWorkoutTemplates';
import { completeAnswers } from '../../workoutPrescription/__tests__/fixtures';
import { legacyTrainingDays } from '../../workoutPrescription/weeklySchedule';
import { toPersistedAnswers } from '../../lib/questionnaireAnswers';
import { resolveWorkoutSchedule } from '../../scheduleEngine/resolver';
import type { Weekday } from '../../state/AppState';
import {
  CANONICAL_LIMITATION_DATASET_HASH,
  CANONICAL_LIMITATION_DATASET_VERSION,
} from '../../workoutPrescription/limitationDataset';

const PROJECT_ID = 'ajfit-rules-test';
const UID = 'carol';
const QUESTIONNAIRE_ID = 'q1';
const TIMEZONE = 'America/Sao_Paulo';
const TRAINING_DAYS: Weekday[] = ['MON', 'TUE', 'THU', 'FRI'];

const enabled = process.env.SCHEDULE_CONFIG_RECONCILIATION_INTEGRATION === '1';

let testEnv: RulesTestEnvironment;

const mocks = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock('../../lib/firebase', () => ({
  get db() {
    return mocks.db;
  },
}));

import { generateAndPersistWorkoutProgram } from '../workoutPrograms';
import {
  ensureScheduleConfigFromQuestionnaire,
  loadScheduleConfig,
  resolveTodaysSchedule,
  saveScheduleConfig,
} from '../workoutSchedule';
import { startOrResumeWorkoutExecution } from '../workoutExecutions';
import { enableWorkoutLifecycleRollout } from './workoutLifecycleRolloutFixture';
import { installWorkoutLifecycleAuthorityFixture, resetWorkoutLifecycleAuthorityFixture } from './workoutLifecycleAuthorityFixture';

const T003_SEED = buildSeedDocuments().find((t) => t.id === 'T003');
if (!T003_SEED) throw new Error('T003 fixture missing — cannot run scheduleConfig reconciliation integration tests');

const VALID_ANSWERS = completeAnswers({
  level: 'intermediate', days: 4, place: 'gym', sex: 'm', goal: 'gain_muscle',
  trainingDays: TRAINING_DAYS,
});

async function seedUserQuestionnaireAndTemplate() {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const rawDb = ctx.firestore();
    await setDoc(doc(rawDb, 'users', UID), {
      profile: { name: 'Carol', email: 'carol@example.com' },
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
      answers: toPersistedAnswers(VALID_ANSWERS),
      version: 1,
      createdAt: Timestamp.now(),
    });
  });
}

async function createActiveProgram() {
  const result = await generateAndPersistWorkoutProgram({
    uid: UID, questionnaireId: QUESTIONNAIRE_ID, questionnaireVersion: 1,
    answers: VALID_ANSWERS, source: 'automatic_reconciliation',
  });
  if (result.status !== 'SUCCESS') throw new Error(`Fixture setup failed: ${JSON.stringify(result)}`);
  return result.program;
}

describe.skipIf(!enabled)('scheduleConfig reconciliation — real Firestore Emulator integration', () => {
  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: { rules: readFileSync(resolve(__dirname, '../../../firestore.rules'), 'utf8') },
    });
    mocks.db = testEnv.authenticatedContext(UID, { email: 'carol@example.com', email_verified: true }).firestore();
    installWorkoutLifecycleAuthorityFixture(testEnv, UID);
  });

  afterAll(async () => {
    resetWorkoutLifecycleAuthorityFixture();
    await testEnv.cleanup();
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
    await enableWorkoutLifecycleRollout(testEnv);
    await seedUserQuestionnaireAndTemplate();
  });

  it('(4)(5) trainingDays from the questionnaire creates scheduleConfig automatically, in canonical order', async () => {
    expect(await loadScheduleConfig(UID)).toBeNull();

    const created = await ensureScheduleConfigFromQuestionnaire(UID, TRAINING_DAYS, TIMEZONE);

    expect(created).toEqual({ scheduleMode: 'fixed', trainingDays: TRAINING_DAYS, timezone: TIMEZONE, scheduleVersion: 1 });
    const reloaded = await loadScheduleConfig(UID);
    expect(reloaded?.trainingDays).toEqual(TRAINING_DAYS); // canonical WEEKDAY_ORDER, not click order
  });

  it('(5) an out-of-order trainingDays input is still stored in canonical order when normalized by the caller', async () => {
    // `useWorkoutSchedule` normalizes with `normalizeWeekdays` before calling
    // this — this proves the service layer itself does not silently
    // reorder or corrupt whatever array it is given, i.e. canonical order
    // is a caller responsibility this function faithfully persists.
    const reordered: Weekday[] = ['SAT', 'MON', 'FRI', 'WED', 'TUE'];
    await ensureScheduleConfigFromQuestionnaire(UID, reordered, TIMEZONE);
    const reloaded = await loadScheduleConfig(UID);
    expect(reloaded?.trainingDays).toEqual(reordered);
  });

  it('(6) an existing scheduleConfig (e.g. user-edited afterward) is never overwritten by reconciliation', async () => {
    const userChoice: Weekday[] = ['TUE', 'THU'];
    await saveScheduleConfig(UID, { trainingDays: userChoice, timezone: 'UTC' });

    const result = await ensureScheduleConfigFromQuestionnaire(UID, TRAINING_DAYS, TIMEZONE);

    expect(result?.trainingDays).toEqual(userChoice); // returns the EXISTING config, not the questionnaire's
    const reloaded = await loadScheduleConfig(UID);
    expect(reloaded?.trainingDays).toEqual(userChoice);
    expect(reloaded?.timezone).toBe('UTC');
  });

  it('(7) retrying after it already exists is a safe no-op — no duplicated/corrupted state', async () => {
    await ensureScheduleConfigFromQuestionnaire(UID, TRAINING_DAYS, TIMEZONE);
    const second = await ensureScheduleConfigFromQuestionnaire(UID, TRAINING_DAYS, TIMEZONE);
    expect(second).toEqual({ scheduleMode: 'fixed', trainingDays: TRAINING_DAYS, timezone: TIMEZONE, scheduleVersion: 1 });

    const snapshot = await getDoc(doc(mocks.db as never, 'users', UID, 'workoutProgramState', 'scheduleConfig'));
    expect(snapshot.exists()).toBe(true);
  });

  it('(8) two concurrent reconciliation attempts converge — exactly one scheduleConfig document exists', async () => {
    const [a, b] = await Promise.all([
      ensureScheduleConfigFromQuestionnaire(UID, TRAINING_DAYS, TIMEZONE),
      ensureScheduleConfigFromQuestionnaire(UID, TRAINING_DAYS, TIMEZONE),
    ]);
    expect(a).toEqual(b);
    const snapshot = await getDoc(doc(mocks.db as never, 'users', UID, 'workoutProgramState', 'scheduleConfig'));
    expect(snapshot.exists()).toBe(true);
    expect(snapshot.data()?.trainingDays).toEqual(TRAINING_DAYS);
  });

  it('clears a persisted miss decision that no longer exists in the current calendar walk', async () => {
    const program = await createActiveProgram();
    await ensureScheduleConfigFromQuestionnaire(UID, TRAINING_DAYS, TIMEZONE);
    const programInstanceId = program.programInstanceId!;
    const todayLocalDate = '2026-09-09'; // WED — not in the fixture schedule.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(
        ctx.firestore(), 'users', UID, 'workoutPrograms', program.programId,
        'scheduleState', programInstanceId,
      ), {
        programId: program.programId,
        programInstanceId,
        nextSessionIndex: 0,
        cursorDate: todayLocalDate,
        lastCompletedAt: null,
        pendingMissDecision: {
          missedSessionIndex: 0,
          calendarSessionIndex: 1,
          missedScheduledDate: '2026-09-08',
          detectedOnDate: todayLocalDate,
        },
        updatedAt: Timestamp.now(),
      });
    });

    const resolution = await resolveTodaysSchedule({
      uid: UID,
      programId: program.programId,
      programInstanceId,
      sessionCount: program.prescribedTrainingFrequency ?? program.sessions.length,
      activatedAtLocalDate: todayLocalDate,
      todayLocalDate,
      trainingDaysOverride: legacyTrainingDays(program),
    });

    expect(resolution.status).toBe('REST_DAY');
    const state = await getDoc(doc(
      mocks.db as never, 'users', UID, 'workoutPrograms', program.programId,
      'scheduleState', programInstanceId,
    ));
    expect(state.data()?.pendingMissDecision).toBeNull();
  });

  it('(9)(10) once scheduleConfig exists, a training day resolves SESSION_READY — never SCHEDULE_SETUP_REQUIRED', async () => {
    const program = await createActiveProgram();
    await ensureScheduleConfigFromQuestionnaire(UID, TRAINING_DAYS, TIMEZONE);
    const config = await loadScheduleConfig(UID);
    expect(config).not.toBeNull();

    // MON is a training day.
    const monday = '2026-08-31';
    const resolution = resolveWorkoutSchedule({
      hasActiveProgram: true,
      sessionCount: program.sessions.length,
      config,
      state: null,
      activatedAtLocalDate: monday,
      todayLocalDate: monday,
    });

    expect(resolution.status).not.toBe('SCHEDULE_SETUP_REQUIRED');
    expect(resolution.status).toBe('SESSION_READY');
  });

  it('creates and resolves explicit flexible config without trainingDays', async () => {
    const created = await ensureScheduleConfigFromQuestionnaire(UID, [], TIMEZONE, 'flexible');
    expect(created).toEqual({ scheduleMode: 'flexible', trainingDays: [], timezone: TIMEZONE, scheduleVersion: 1 });
    const resolution = resolveWorkoutSchedule({
      hasActiveProgram: true,
      sessionCount: 3,
      scheduleMode: 'flexible',
      config: created,
      state: null,
      activatedAtLocalDate: '2026-08-31',
      todayLocalDate: '2026-09-06',
    });
    expect(resolution).toEqual({ status: 'SESSION_READY', sessionIndex: 0 });
  });

  it('(11) a non-training day resolves REST_DAY', async () => {
    const program = await createActiveProgram();
    const config = await ensureScheduleConfigFromQuestionnaire(UID, TRAINING_DAYS, TIMEZONE);

    // SUN is not in TRAINING_DAYS.
    const sunday = '2026-08-30';
    const resolution = resolveWorkoutSchedule({
      hasActiveProgram: true,
      sessionCount: program.sessions.length,
      config,
      state: null,
      activatedAtLocalDate: sunday,
      todayLocalDate: sunday,
    });

    expect(resolution.status).toBe('REST_DAY');
  });

  it('(12) SESSION_READY allows execution.start to create a real workoutExecution document', async () => {
    const program = await createActiveProgram();
    await ensureScheduleConfigFromQuestionnaire(UID, TRAINING_DAYS, TIMEZONE);

    const execution = await startOrResumeWorkoutExecution({
      uid: UID, program, sessionIndex: 0, scheduledLocalDate: '2026-08-31',
    });

    expect(execution.status).toBe('IN_PROGRESS');
    const docs = await getDocs(collection(mocks.db as never, 'users', UID, 'workoutExecutions'));
    expect(docs.size).toBe(1);
  });

  it('(13) REST_DAY provides no session to start — the resolver never hands back a sessionIndex to act on', async () => {
    const program = await createActiveProgram();
    const config = await ensureScheduleConfigFromQuestionnaire(UID, TRAINING_DAYS, TIMEZONE);
    const sunday = '2026-08-30';
    const resolution = resolveWorkoutSchedule({
      hasActiveProgram: true,
      sessionCount: program.sessions.length,
      config,
      state: null,
      activatedAtLocalDate: sunday,
      todayLocalDate: sunday,
    });
    expect(resolution.status).toBe('REST_DAY');
    expect('sessionIndex' in resolution).toBe(false);
    // AppShell's own gate (`startWorkout`, unchanged by this phase) only
    // calls `execution.start` when `schedule.resolution.status ===
    // 'SESSION_READY'` — a REST_DAY resolution carries no sessionIndex for
    // it to act on in the first place.
  });
});
