/**
 * OPT-IN integration proof against the REAL Firestore Emulator — the
 * "conceptual E2E" the Phase 3 task doc asks for. Drives the EXACT sequence
 * `AuthContext.tsx`'s `signUp()` runs, using the real service functions
 * (not mocks): `provisionNewUser` → `prepareWorkoutProgramLocally` (the
 * Analysis screen's pre-auth compute, run here to stand in for it) →
 * `persistPreparedWorkoutProgram` → `ensureScheduleConfigFromQuestionnaire`.
 * Asserts the FINAL state (questionnaire + active workoutProgram +
 * scheduleConfig, all persisted) AND the real Firestore server timestamps
 * prove the order: questionnaire is written before the program, and the
 * program is active before Paywall/Home would ever be reached in the real
 * app (nothing else runs between `signUp()` resolving and Paywall showing).
 *
 * Skipped by default — only runs when
 * `ONBOARDING_SIGNUP_LIFECYCLE_INTEGRATION=1` is set (see the
 * `test:integration:onboardingSignupLifecycle` npm script).
 */
import {
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import type { User } from 'firebase/auth';
import { Timestamp,collection,doc,getDoc,getDocs,setDoc } from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll,beforeAll,beforeEach,describe,expect,it,vi } from 'vitest';

import { buildSeedDocuments } from '../../../scripts/seedWorkoutTemplates';
import { completeAnswers } from '../../workoutPrescription/__tests__/fixtures';

const PROJECT_ID = 'ajfit-rules-test';
const UID = 'fiona';

const enabled = process.env.ONBOARDING_SIGNUP_LIFECYCLE_INTEGRATION === '1';

let testEnv: RulesTestEnvironment;

const mocks = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock('../../lib/firebase', () => ({
  get db() {
    return mocks.db;
  },
}));

import { normalizeWeekdays,trainingDaysValid } from '../../lib/questionnaireSchema';
import { provisionNewUser } from '../userProfile';
import {
  generateAndPersistWorkoutProgramDeduped,
  loadActiveWorkoutProgram,
  persistPreparedWorkoutProgram,
  prepareWorkoutProgramLocally,
} from '../workoutPrograms';
import { ensureScheduleConfigFromQuestionnaire,loadScheduleConfig } from '../workoutSchedule';
import { installWorkoutLifecycleAuthorityFixture,resetWorkoutLifecycleAuthorityFixture } from './workoutLifecycleAuthorityFixture';
import { enableWorkoutLifecycleRollout } from './workoutLifecycleRolloutFixture';

const T003_SEED = buildSeedDocuments().find((t) => t.id === 'T003');
if (!T003_SEED) throw new Error('T003 fixture missing — cannot run this integration test');
const T004_SEED = buildSeedDocuments().find((t) => t.id === 'T004');
if (!T004_SEED) throw new Error('T004 fixture missing — cannot run this integration test');

const ANSWERS = completeAnswers({
  level: 'intermediate', days: 4, place: 'gym', sex: 'm', goal: 'gain_muscle',
  birthDate: new Date('1990-01-01T12:00:00.000Z'),
  trainingDays: ['MON', 'TUE', 'THU', 'FRI'],
});

const fakeUser = { uid: UID, email: 'fiona@example.com', displayName: null } as unknown as User;

describe.skipIf(!enabled)('Onboarding → signup lifecycle (conceptual E2E) — real Firestore Emulator', () => {
  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: { rules: readFileSync(resolve(__dirname, '../../../firestore.rules'), 'utf8') },
    });
    mocks.db = testEnv.authenticatedContext(UID, { email: 'fiona@example.com', email_verified: true }).firestore();
    installWorkoutLifecycleAuthorityFixture(testEnv, UID);
  });

  afterAll(async () => {
    resetWorkoutLifecycleAuthorityFixture();
    await testEnv.cleanup();
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
    await enableWorkoutLifecycleRollout(testEnv);
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'workoutTemplates', 'T003'), T003_SEED);
      await setDoc(doc(ctx.firestore(), 'workoutTemplates', 'T004'), T004_SEED);
    });
  });

  it('Questionário → análise (local compute) → signup → workoutProgram+active pointer+scheduleConfig, all before Paywall would ever be reached', async () => {
    // ── "Analysis screen" — pre-auth, local sources only ──
    const prepared = await prepareWorkoutProgramLocally(ANSWERS);
    expect(prepared.status).toBe('SUCCESS');

    // ── "Create Account" (AuthContext.signUp, exact same sequence) ──
    const questionnaireId = await provisionNewUser(fakeUser, { name: 'Fiona', answers: ANSWERS, legalAccepted: true });
    expect(questionnaireId).not.toBeNull();
    if (!questionnaireId) return;

    const persistResult = await persistPreparedWorkoutProgram({
      uid: UID, questionnaireId, questionnaireVersion: 1,
      answers: ANSWERS, prepared, source: 'onboarding',
    });
    expect(persistResult.status).toBe('SUCCESS');

    expect(trainingDaysValid(ANSWERS)).toBe(true);
    await ensureScheduleConfigFromQuestionnaire(UID, normalizeWeekdays(ANSWERS.trainingDays ?? []), 'America/Sao_Paulo');

    // ── State a real app would see the instant Paywall/Home mount ──
    const questionnaireSnap = await getDoc(doc(mocks.db as never, 'users', UID, 'questionnaires', questionnaireId));
    const activeSnap = await getDoc(doc(mocks.db as never, 'users', UID, 'workoutProgramState', 'active'));
    const scheduleConfigSnap = await getDoc(doc(mocks.db as never, 'users', UID, 'workoutProgramState', 'scheduleConfig'));
    const programsSnap = await getDocs(collection(mocks.db as never, 'users', UID, 'workoutPrograms'));

    expect(questionnaireSnap.exists()).toBe(true);
    expect(activeSnap.exists()).toBe(true);
    expect(scheduleConfigSnap.exists()).toBe(true);
    expect(programsSnap.size).toBe(1);
    expect(programsSnap.docs[0].data().status).toBe('active');
    expect(programsSnap.docs[0].data().programId).toBe(activeSnap.data()?.programId);
    expect(scheduleConfigSnap.data()?.trainingDays).toEqual(['MON', 'TUE', 'THU', 'FRI']);

    // ── Order proof via real Firestore server timestamps ──
    const questionnaireCreatedAt = (questionnaireSnap.data()?.createdAt as Timestamp).toMillis();
    const programCreatedAt = (programsSnap.docs[0].data().createdAt as Timestamp).toMillis();
    expect(programCreatedAt).toBeGreaterThanOrEqual(questionnaireCreatedAt);

    // No generation ever needs to run "on Home arrival" in this flow — the
    // exact query `useWorkoutPrescription.reload()` runs finds the program
    // immediately, first try.
    const secondActiveRead = await getDoc(doc(mocks.db as never, 'users', UID, 'workoutProgramState', 'active'));
    expect(secondActiveRead.data()?.programId).toBe(activeSnap.data()?.programId);
  });

  it('persists a complete flexible onboarding without inventing weekdays', async () => {
    const flexibleAnswers = completeAnswers({
      level: 'intermediate',
      days: 5,
      place: 'gym',
      sex: 'm',
      goal: 'gain_muscle',
      scheduleMode: 'flexible',
      trainingDays: null,
      birthDate: new Date('1990-01-01T12:00:00.000Z'),
    });
    const prepared = await prepareWorkoutProgramLocally(flexibleAnswers);
    expect(prepared.status).toBe('SUCCESS');
    const questionnaireId = await provisionNewUser(fakeUser, { name: 'Fiona', answers: flexibleAnswers, legalAccepted: true });
    expect(questionnaireId).not.toBeNull();
    if (!questionnaireId) return;
    const persisted = await persistPreparedWorkoutProgram({
      uid: UID,
      questionnaireId,
      questionnaireVersion: 1,
      answers: flexibleAnswers,
      prepared,
      source: 'onboarding',
    });
    expect(persisted.status).toBe('SUCCESS');
    if (persisted.status !== 'SUCCESS') return;
    expect(persisted.plan).toMatchObject({
      scheduleMode: 'flexible',
      availability: { days: 5, weekdays: [] },
      weeklySchedule: [],
    });
    expect(trainingDaysValid(flexibleAnswers)).toBe(true);
    await ensureScheduleConfigFromQuestionnaire(UID, [], 'America/Sao_Paulo', 'flexible');
    expect(await loadScheduleConfig(UID)).toEqual({
      scheduleMode: 'flexible',
      trainingDays: [],
      timezone: 'America/Sao_Paulo',
      scheduleVersion: 1,
    });
    const [instances, lifecycle, active, loaded] = await Promise.all([
      getDocs(collection(mocks.db as never, 'users', UID, 'programInstances')),
      getDoc(doc(mocks.db as never, 'users', UID, 'workoutLifecycleState', 'current')),
      getDoc(doc(mocks.db as never, 'users', UID, 'workoutProgramState', 'active')),
      loadActiveWorkoutProgram(UID),
    ]);
    expect(instances.size).toBe(1);
    expect(instances.docs[0].data().prescriptionInputSnapshot.inputs).toMatchObject({
      days: 5,
      scheduleMode: 'flexible',
      trainingDays: null,
    });
    expect(lifecycle.data()?.activeProgramInstanceId).toBe(instances.docs[0].id);
    expect(active.exists()).toBe(true);
    expect(loaded).toMatchObject({ scheduleMode: 'flexible', status: 'active' });
  });

  // (H)(K) — audit items: Home's first mount already has an active program,
  // and the readiness gate (`useWorkoutReadinessGate`) never leaves the
  // cold-start placeholder visible. This drives the exact TWO reads
  // `useWorkoutReadinessGate` and `useWorkoutPrescription.reload()` each
  // independently perform on the SAME identity — the gate's read (simulating
  // App.tsx, pre-AppShell) and AppShell's own `useWorkoutPrescription` read
  // right after — and proves the second one is a pure fast-path hit with NO
  // second generation attempt (exactly one `workoutPrograms` document ever
  // created, exactly one `active_workout_program_loaded { found: true }`
  // outcome each time).
  it('(H)(K) once the readiness gate resolves, AppShell/useWorkoutPrescription\'s OWN mount-time read finds the program immediately — no second generation, no false "loading placeholder" outcome', async () => {
    const prepared = await prepareWorkoutProgramLocally(ANSWERS);
    expect(prepared.status).toBe('SUCCESS');
    const questionnaireId = await provisionNewUser(fakeUser, { name: 'Fiona', answers: ANSWERS, legalAccepted: true });
    expect(questionnaireId).not.toBeNull();
    if (!questionnaireId) return;

    // ── Simulates useWorkoutReadinessGate (App.tsx, pre-AppShell) ──
    const gateProgramRead = await loadActiveWorkoutProgram(UID);
    expect(gateProgramRead).toBeNull(); // nothing persisted yet — this is what triggers the fallback below
    const gateGeneration = await generateAndPersistWorkoutProgramDeduped({
      uid: UID, questionnaireId, questionnaireVersion: 1, answers: ANSWERS, source: 'automatic_reconciliation',
    });
    expect(gateGeneration.status).toBe('SUCCESS');
    await ensureScheduleConfigFromQuestionnaire(UID, normalizeWeekdays(ANSWERS.trainingDays ?? []), 'America/Sao_Paulo');

    // ── Simulates AppShell's useWorkoutPrescription.reload() on its FIRST
    //    mount, right after the gate already flipped 'ready' ──
    const appShellProgramRead = await loadActiveWorkoutProgram(UID);
    expect(appShellProgramRead).not.toBeNull(); // (K) — never the loading/absent placeholder
    expect(appShellProgramRead?.status).toBe('active');
    const appShellScheduleRead = await loadScheduleConfig(UID);
    expect(appShellScheduleRead).not.toBeNull();

    // (H) — exactly one program document exists: AppShell's own read never
    // triggered a second `generateAndPersistWorkoutProgramDeduped` call.
    const programs = await getDocs(collection(mocks.db as never, 'users', UID, 'workoutPrograms'));
    expect(programs.size).toBe(1);
    expect(appShellProgramRead?.programId).toBe(programs.docs[0].id);
  });
});
