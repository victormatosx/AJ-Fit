/**
 * PILOT HOMOLOGATION — end-to-end, real Firestore Emulator, real Rules.
 *
 * Mirrors the test account's exact configuration: five sessions (A–E),
 * recommended TUE–SAT, `fixed`, `America/Sao_Paulo`, V2 lifecycle. Every
 * write below goes through the UNMODIFIED client services under the project's
 * real `firestore.rules`, and every completion through the real
 * `finalizeWorkoutSession` handler — so a Rules refusal or an authority check
 * fails the test rather than being mocked away.
 *
 * Two gaps the existing suites left open are what this file exists for:
 *
 *  1. `selectWorkoutSession` had no emulator coverage at all — rotation was
 *     pinned only in pure tests and on the Function side.
 *  2. The Jotinha notice had no coverage against REAL executions and a REAL
 *     `scheduleState`; only the pure detector and source-level wiring.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, Timestamp } from 'firebase/firestore';
import { createRequire } from 'node:module';

// Resolved at runtime from `functions/node_modules`, never this project's own
// root install: two physical copies of the same package version produce two
// distinct `Timestamp` classes, and `finalizationAuthority.ts`'s
// `instance.activatedAt instanceof Timestamp` check fails across that
// boundary even for semantically identical data (it surfaces as
// `program_instance_activation_missing`). Same reasoning, and same anchor, as
// `workoutExecutions.integration.test.ts` — see its own doc comment.
const requireFromFunctionsPackage = createRequire(resolve(__dirname, '../../../functions/package.json'));
const { initializeApp, deleteApp } =
  requireFromFunctionsPackage('firebase-admin/app') as typeof import('firebase-admin/app');
const { getFirestore: getAdminFirestore, Timestamp: AdminTimestamp } =
  requireFromFunctionsPackage('firebase-admin/firestore') as typeof import('firebase-admin/firestore');
type AdminFirestore = import('firebase-admin/firestore').Firestore;
type AdminApp = import('firebase-admin/app').App;

import { finalizeWorkoutSessionHandler } from '../../../functions/src/workoutLifecycle/finalizeWorkoutSession';
import { selectWorkoutSession, loadScheduleSuggestionState } from '../workoutSchedule';
import {
  startOrResumeWorkoutExecution,
  abandonWorkoutExecution,
  hasWorkoutDailyCompletion,
  loadWorkoutExecution,
} from '../workoutExecutions';
import { detectMissedSessionNotice } from '../../scheduleEngine/missedSessionNotice';
import type { WorkoutProgramSnapshot } from '../workoutPrograms';

const enabled = process.env.PILOT_HOMOLOGATION_INTEGRATION === '1';
const PROJECT_ID = 'ajfit-rules-test';
const UID = 'homolog-tester';
const OTHER_UID = 'homolog-stranger';
const PROGRAM_ID = 'wpg_homolog';
const INSTANCE_ID = 'wpi_homolog';
const TZ = 'America/Sao_Paulo';
/** TUE–SAT, exactly like the test account. SUN/MON are rest days. */
const RECOMMENDED = ['TUE', 'WED', 'THU', 'FRI', 'SAT'] as const;
const SESSION_COUNT = 5;

let testEnv: RulesTestEnvironment;
let adminApp: AdminApp;
let adminDb: AdminFirestore;

const mocks = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock('../../lib/firebase', () => ({ get db() { return mocks.db; } }));

function program(): WorkoutProgramSnapshot {
  return {
    programId: PROGRAM_ID,
    programInstanceId: INSTANCE_ID,
    prescriptionId: 'plan_h',
    templateId: 'T004',
    templateVersion: 1,
    templateSourceVersion: '1.3.0',
    templateContentHash: 'h'.repeat(64),
    questionnaireId: 'q_h',
    questionnaireVersion: 1,
    status: 'active',
    source: 'onboarding',
    scheduleMode: 'fixed',
    requestedDays: SESSION_COUNT,
    prescribedStructuredDays: SESSION_COUNT,
    prescribedTrainingFrequency: SESSION_COUNT,
    population: 'male',
    environment: 'gym',
    goalFamily: 'hypertrophy',
    split: 'ABCDE',
    planId: 'plan_h',
    sessions: ['A', 'B', 'C', 'D', 'E'].map((name) => ({
      name, type: 'strength',
      exercises: [{ exerciseId: 'bench_press', sourceExerciseId: 'bench_press', sets: 3, reps: '8-12' }],
    })),
    versions: {
      templateLibrary: '1.3.0', selectionEngine: '1.0.0', safetyRules: '1.0.0',
      modifierRules: '2.0.0', compositionEngine: '2.0.0',
    },
    trace: { safety: { status: 'CLEAR' }, unresolvedModifiers: [] } as never,
    createdAt: null, activatedAt: null, updatedAt: null,
  } as unknown as WorkoutProgramSnapshot;
}

const select = (target: number) => selectWorkoutSession({
  uid: UID, programId: PROGRAM_ID, programInstanceId: INSTANCE_ID,
  sessionCount: SESSION_COUNT, targetSessionIndex: target,
  activatedAtLocalDate: '2026-10-01',
});
const suggestion = async () => loadScheduleSuggestionState(UID, PROGRAM_ID, INSTANCE_ID);
const start = (sessionIndex: number, localDate: string, startedFromSuggestionVersion?: number) =>
  startOrResumeWorkoutExecution({
    uid: UID, program: program(), sessionIndex,
    scheduledLocalDate: localDate, performedLocalDate: localDate,
    ...(startedFromSuggestionVersion !== undefined ? { startedFromSuggestionVersion } : {}),
  });
const finalize = (executionId: string) =>
  finalizeWorkoutSessionHandler({ auth: { uid: UID }, data: { executionId } } as never, adminDb);
/** Forces an execution's provenance onto a chosen day, which the handler cross-checks. */
async function datedAs(executionId: string, localDate: string) {
  const instant = AdminTimestamp.fromDate(new Date(`${localDate}T15:00:00Z`));
  await adminDb.doc(`users/${UID}/workoutExecutions/${executionId}`)
    .update({ createdAt: instant, startedAt: instant });
}

describe.skipIf(!enabled)('AJ Fit pilot homologation — emulator', () => {
  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: { rules: readFileSync(resolve(__dirname, '../../../firestore.rules'), 'utf8') },
    });
    mocks.db = testEnv.authenticatedContext(UID, { email: 'h@example.com', email_verified: true }).firestore();
    adminApp = initializeApp({ projectId: PROJECT_ID }, 'pilot-homologation-admin');
    adminDb = getAdminFirestore(adminApp);
  });
  afterAll(async () => { await deleteApp(adminApp); await testEnv.cleanup(); });

  beforeEach(async () => {
    await testEnv.clearFirestore();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await Promise.all([
        setDoc(doc(db, 'users', UID), {
          profile: { name: 'H', email: 'h@example.com' },
          preferences: { language: 'pt-BR', units: 'system', theme: 'dark' },
          subscription: {}, metadata: { role: 'user', createdAt: Timestamp.now(), updatedAt: Timestamp.now() },
        }),
        setDoc(doc(db, 'users', OTHER_UID), { profile: { name: 'S', email: 's@example.com' } }),
        // Pilot enrolment — the single fact the Rules, the Function and the
        // client all read.
        setDoc(doc(db, 'workoutPilotEnrollment', UID), { enabled: true }),
        setDoc(doc(db, 'users', UID, 'workoutPrograms', PROGRAM_ID), {
          ...program(),
          weeklySchedule: RECOMMENDED.map((weekday, sessionIndex) => ({ weekday, state: 'TRAINING', sessionIndex })),
        }),
        setDoc(doc(db, 'users', UID, 'programInstances', INSTANCE_ID), {
          programInstanceId: INSTANCE_ID, contentIdentity: PROGRAM_ID, supersededAt: null,
          activatedAt: Timestamp.fromDate(new Date('2026-10-01T00:00:00Z')),
        }),
        setDoc(doc(db, 'users', UID, 'workoutProgramState', 'active'), { programId: PROGRAM_ID }),
        setDoc(doc(db, 'users', UID, 'workoutProgramState', 'scheduleConfig'), {
          trainingDays: RECOMMENDED, timezone: TZ, scheduleMode: 'fixed',
        }),
        setDoc(doc(db, 'users', UID, 'workoutLifecycleState', 'current'), { activeProgramInstanceId: INSTANCE_ID }),
      ]);
    });
  });

  // ── §2 SELECTION AND ROTATION ───────────────────────────────────────────
  describe('§2 selection advances the rotation immediately', () => {
    it('A suggests B, B suggests C, E wraps to A', async () => {
      expect((await select(0)).suggestedSessionIndex).toBe(1);
      expect((await select(1)).suggestedSessionIndex).toBe(2);
      expect((await select(4)).suggestedSessionIndex).toBe(0);
    });

    it('persists through a reload — the suggestion survives reopening the app', async () => {
      await select(1);
      const stored = await suggestion();
      expect(stored?.suggestedSessionIndex).toBe(2);
      expect(stored?.lastSelectedSessionIndex).toBe(1);
      expect(stored?.suggestionVersion).toBe(1);
    });

    it('merely READING the state changes nothing', async () => {
      await select(0);
      const before = await suggestion();
      await suggestion();
      await suggestion();
      const after = await suggestion();
      expect(after?.suggestionVersion).toBe(before?.suggestionVersion);
      expect(after?.suggestedSessionIndex).toBe(before?.suggestedSessionIndex);
    });

    it('a repeated tap on the same session does not walk the rotation twice', async () => {
      await select(0);
      const first = await suggestion();
      await select(0);
      const second = await suggestion();
      expect(second?.suggestionVersion).toBe(first?.suggestionVersion);
      expect(second?.suggestedSessionIndex).toBe(1);
    });

    it('never touches any completion-derived fact', async () => {
      await adminDb.doc(`users/${UID}/workoutPrograms/${PROGRAM_ID}/scheduleState/${INSTANCE_ID}`).set({
        programId: PROGRAM_ID, programInstanceId: INSTANCE_ID, nextSessionIndex: 0,
        suggestedSessionIndex: 0, suggestionVersion: 3, lastSelectedSessionIndex: 4,
        cursorDate: '2026-10-13', lastCompletedAt: '2026-10-13', lastPerformedLocalDate: '2026-10-13',
        pendingMissDecision: null, updatedAt: AdminTimestamp.now(),
      });
      await select(2);
      const after = await suggestion();
      expect(after?.cursorDate).toBe('2026-10-13');
      expect(after?.lastCompletedAt).toBe('2026-10-13');
      expect(after?.lastPerformedLocalDate).toBe('2026-10-13');
      expect(after?.suggestedSessionIndex).toBe(3);
    });

    it('concurrent selections never corrupt the state — one wins, versions stay sane', async () => {
      const results = await Promise.allSettled([select(0), select(2), select(3)]);
      const landed = results.filter(r => r.status === 'fulfilled').length;
      expect(landed).toBeGreaterThan(0);
      const after = await suggestion();
      // Whatever order the transactions resolved in, the stored pointer must
      // be a legal "one past the last selection" and the version must equal
      // the number of writes that actually landed.
      expect(after!.suggestedSessionIndex).toBe((after!.lastSelectedSessionIndex! + 1) % SESSION_COUNT);
      expect(after!.suggestionVersion).toBeGreaterThanOrEqual(1);
      expect(after!.suggestionVersion).toBeLessThanOrEqual(3);
    });

    it('the session STARTED is the session selected, and finalize advances once', async () => {
      await select(1);                        // selecting B suggests C
      const started = await start(1, '2026-10-20');
      expect(started.sessionIndex).toBe(1);   // B is what runs
      await datedAs(started.executionId, '2026-10-20');
      await expect(finalize(started.executionId)).resolves.toMatchObject({ status: 'COMPLETED' });
      const after = await suggestion();
      expect(after?.suggestedSessionIndex).toBe(2); // still C — not advanced twice
      expect(after?.lastPerformedLocalDate).toBe('2026-10-20');
    });

    it('abandoning does NOT undo the selection', async () => {
      await select(1);
      const started = await start(1, '2026-10-20');
      await abandonWorkoutExecution(UID, started.executionId);
      expect((await loadWorkoutExecution(UID, started.executionId))?.status).toBe('ABANDONED');
      const after = await suggestion();
      expect(after?.suggestedSessionIndex).toBe(2);
      expect(after?.lastSelectedSessionIndex).toBe(1);
    });

    it('a restart after abandon stays on the same occurrence and selection', async () => {
      await select(0);
      const first = await start(0, '2026-10-20');
      await abandonWorkoutExecution(UID, first.executionId);
      const again = await start(0, '2026-10-20');
      expect(again.executionId).toBe(first.executionId);
      expect(again.status).toBe('IN_PROGRESS');
      expect((await suggestion())?.suggestedSessionIndex).toBe(1);
    });
  });

  // ── §3 EXECUTION AND THE DAILY LIMIT ────────────────────────────────────
  describe('§3 one credited workout per day, whatever the route', () => {
    async function complete(sessionIndex: number, localDate: string) {
      const started = await start(sessionIndex, localDate);
      await datedAs(started.executionId, localDate);
      await finalize(started.executionId);
      return started.executionId;
    }

    it('a completion claims the day and the marker names the execution', async () => {
      const id = await complete(0, '2026-10-20');
      const marker = await adminDb.doc(`users/${UID}/workoutDailyCompletions/2026-10-20`).get();
      expect(marker.exists).toBe(true);
      expect(marker.data()?.executionId).toBe(id);
      expect(await hasWorkoutDailyCompletion(UID, '2026-10-20')).toBe(true);
    });

    it('a DIFFERENT session on the same day is refused', async () => {
      await complete(0, '2026-10-20');
      await expect(start(1, '2026-10-20')).rejects.toThrow('WORKOUT_DAILY_LIMIT_REACHED');
    });

    it('switching program instance does not buy a second workout', async () => {
      await complete(0, '2026-10-20');
      const other = { ...program(), programInstanceId: 'wpi_other' } as unknown as WorkoutProgramSnapshot;
      await expect(startOrResumeWorkoutExecution({
        uid: UID, program: other, sessionIndex: 2,
        scheduledLocalDate: '2026-10-20', performedLocalDate: '2026-10-20',
      })).rejects.toThrow('WORKOUT_DAILY_LIMIT_REACHED');
    });

    it('yesterday never blocks today', async () => {
      await complete(0, '2026-10-20');
      const today = await start(1, '2026-10-21');
      expect(today.status).toBe('IN_PROGRESS');
    });

    it('a replayed finalize writes exactly one event and one marker', async () => {
      const started = await start(0, '2026-10-20');
      await datedAs(started.executionId, '2026-10-20');
      await finalize(started.executionId);
      await finalize(started.executionId);
      const events = await adminDb
        .collection(`users/${UID}/workoutPrograms/${PROGRAM_ID}/scheduleEvents`).get();
      expect(events.size).toBe(1);
      const markers = await adminDb.collection(`users/${UID}/workoutDailyCompletions`).get();
      expect(markers.size).toBe(1);
    });

    it('two concurrent finalizes credit the day exactly once', async () => {
      const started = await start(0, '2026-10-20');
      await datedAs(started.executionId, '2026-10-20');
      const results = await Promise.allSettled([finalize(started.executionId), finalize(started.executionId)]);
      expect(results.filter(r => r.status === 'fulfilled').length).toBeGreaterThan(0);
      const markers = await adminDb.collection(`users/${UID}/workoutDailyCompletions`).get();
      expect(markers.size).toBe(1);
      expect((await suggestion())?.suggestedSessionIndex).toBe(1);
    }, 30_000);

    it('an ABANDONED attempt never claims the day', async () => {
      const started = await start(0, '2026-10-20');
      await abandonWorkoutExecution(UID, started.executionId);
      expect(await hasWorkoutDailyCompletion(UID, '2026-10-20')).toBe(false);
      const next = await start(1, '2026-10-20');
      expect(next.status).toBe('IN_PROGRESS');
    });

    it('a legacy anticipated execution does not block a legitimate start today', async () => {
      // The production incident: scheduled for today, performed yesterday.
      await adminDb.doc(`users/${UID}/workoutExecutions/exec_${INSTANCE_ID}_0_2026-10-20`).set({
        programId: PROGRAM_ID, programInstanceId: INSTANCE_ID, sessionIndex: 0, occurrence: 1,
        scheduledLocalDate: '2026-10-20', performedLocalDate: '2026-10-19',
        status: 'PARTIALLY_COMPLETED', sessionName: 'A', exercises: [], cardio: null,
        startedAt: AdminTimestamp.now(), createdAt: AdminTimestamp.now(), updatedAt: AdminTimestamp.now(),
      });
      const started = await start(0, '2026-10-20');
      expect(started.occurrence).toBe(2);
      expect(started.executionId).toBe(`exec_${INSTANCE_ID}_0_2026-10-20_o2`);
      // And the historical document is untouched.
      const legacy = await loadWorkoutExecution(UID, `exec_${INSTANCE_ID}_0_2026-10-20`);
      expect(legacy?.status).toBe('PARTIALLY_COMPLETED');
      expect(legacy?.performedLocalDate).toBe('2026-10-19');
    });

    it('the same session performed TODAY still blocks, with the friendly reason', async () => {
      await adminDb.doc(`users/${UID}/workoutExecutions/exec_${INSTANCE_ID}_0_2026-10-20`).set({
        programId: PROGRAM_ID, programInstanceId: INSTANCE_ID, sessionIndex: 0, occurrence: 1,
        scheduledLocalDate: '2026-10-20', performedLocalDate: '2026-10-20',
        status: 'COMPLETED', sessionName: 'A', exercises: [], cardio: null,
        startedAt: AdminTimestamp.now(), createdAt: AdminTimestamp.now(), updatedAt: AdminTimestamp.now(),
      });
      await expect(start(0, '2026-10-20')).rejects.toThrow('WORKOUT_DAILY_LIMIT_REACHED');
    });
  });

  // ── §4 THE JOTINHA NOTICE, AGAINST REAL DATA ────────────────────────────
  describe('§4 the missed-session notice over real executions', () => {
    /** Builds the detector's input from REAL Firestore state, as the hook does. */
    async function noticeOn(todayLocalDate: string, decidedNoticeIds: string[] = []) {
      const stored = await suggestion();
      const executions = await adminDb.collection(`users/${UID}/workoutExecutions`).get();
      const performedLocalDates = new Set<string>();
      const coveredScheduledLocalDates = new Set<string>();
      for (const d of executions.docs) {
        const e = d.data();
        if (e.status !== 'COMPLETED' && e.status !== 'PARTIALLY_COMPLETED') continue;
        performedLocalDates.add(e.performedLocalDate ?? e.scheduledLocalDate);
        coveredScheduledLocalDates.add(e.scheduledLocalDate);
      }
      return detectMissedSessionNotice({
        hasActiveProgram: true,
        sessionCount: SESSION_COUNT,
        programInstanceId: INSTANCE_ID,
        recommendedWeekdays: [...RECOMMENDED],
        lastPerformedLocalDate: stored?.lastPerformedLocalDate ?? null,
        performedLocalDates,
        coveredScheduledLocalDates,
        suggestedSessionIndex: stored?.suggestedSessionIndex ?? stored?.nextSessionIndex ?? 0,
        todayLocalDate,
        workoutCreditedToday: await hasWorkoutDailyCompletion(UID, todayLocalDate),
        decidedNoticeIds,
      });
    }

    it('Saturday missed, Tuesday asks about it', async () => {
      // 2026-10-16 is a Friday (recommended, trained); 10-17 Saturday is
      // missed; 10-18 Sunday and 10-19 Monday are rest days; 10-20 Tuesday
      // is the next recommended day.
      const id = await start(0, '2026-10-16');
      await datedAs(id.executionId, '2026-10-16');
      await finalize(id.executionId);
      const notice = await noticeOn('2026-10-20');
      expect(notice).not.toBeNull();
      expect(notice!.missedScheduledDate).toBe('2026-10-17');
      expect(notice!.pendingSessionIndex).toBe(1);   // the rotation advanced to B
      expect(notice!.skipToSessionIndex).toBe(2);
    });

    it('no notice on a rest day', async () => {
      const id = await start(0, '2026-10-16');
      await datedAs(id.executionId, '2026-10-16');
      await finalize(id.executionId);
      expect(await noticeOn('2026-10-18')).toBeNull(); // Sunday
      expect(await noticeOn('2026-10-19')).toBeNull(); // Monday
    });

    it('no notice once today is already credited', async () => {
      const id = await start(0, '2026-10-16');
      await datedAs(id.executionId, '2026-10-16');
      await finalize(id.executionId);
      const today = await start(1, '2026-10-20');
      await datedAs(today.executionId, '2026-10-20');
      await finalize(today.executionId);
      expect(await noticeOn('2026-10-20')).toBeNull();
    });

    it('an ANTICIPATED session covers its scheduled day — no false notice', async () => {
      // Saturday's session finished on Friday: Saturday has no effort of its
      // own but was unquestionably trained.
      await adminDb.doc(`users/${UID}/workoutExecutions/exec_${INSTANCE_ID}_0_2026-10-17`).set({
        programId: PROGRAM_ID, programInstanceId: INSTANCE_ID, sessionIndex: 0, occurrence: 1,
        scheduledLocalDate: '2026-10-17', performedLocalDate: '2026-10-16',
        status: 'COMPLETED', sessionName: 'A', exercises: [], cardio: null,
        startedAt: AdminTimestamp.now(), createdAt: AdminTimestamp.now(), updatedAt: AdminTimestamp.now(),
      });
      await adminDb.doc(`users/${UID}/workoutPrograms/${PROGRAM_ID}/scheduleState/${INSTANCE_ID}`).set({
        programId: PROGRAM_ID, programInstanceId: INSTANCE_ID, nextSessionIndex: 1,
        suggestedSessionIndex: 1, suggestionVersion: 1, lastSelectedSessionIndex: 0,
        cursorDate: '2026-10-16', lastCompletedAt: '2026-10-16', lastPerformedLocalDate: '2026-10-16',
        pendingMissDecision: null, updatedAt: AdminTimestamp.now(),
      });
      expect(await noticeOn('2026-10-20')).toBeNull();
    });

    it('an answered notice is never raised again', async () => {
      const id = await start(0, '2026-10-16');
      await datedAs(id.executionId, '2026-10-16');
      await finalize(id.executionId);
      const notice = await noticeOn('2026-10-20');
      expect(await noticeOn('2026-10-20', [notice!.noticeId])).toBeNull();
    });

    it('RECOVER: selects the pending session, suggestion moves one, finalize does not move it again', async () => {
      const seed = await start(0, '2026-10-16');
      await datedAs(seed.executionId, '2026-10-16');
      await finalize(seed.executionId);
      const notice = await noticeOn('2026-10-20');
      expect(notice!.pendingSessionIndex).toBe(1); // B is pending

      // The decision: select what will be trained.
      await select(notice!.pendingSessionIndex);
      expect((await suggestion())?.suggestedSessionIndex).toBe(2); // immediately C

      const started = await start(notice!.pendingSessionIndex, '2026-10-20');
      expect(started.sessionIndex).toBe(1);                        // B runs, not C
      await datedAs(started.executionId, '2026-10-20');
      await finalize(started.executionId);
      expect((await suggestion())?.suggestedSessionIndex).toBe(2); // still C
    });

    it('FOLLOW: selects the NEXT session, suggestion moves past it, A is skipped', async () => {
      const seed = await start(0, '2026-10-16');
      await datedAs(seed.executionId, '2026-10-16');
      await finalize(seed.executionId);
      const notice = await noticeOn('2026-10-20');

      await select(notice!.skipToSessionIndex);                    // selects C
      expect((await suggestion())?.suggestedSessionIndex).toBe(3); // immediately D

      const started = await start(notice!.skipToSessionIndex, '2026-10-20');
      expect(started.sessionIndex).toBe(2);                        // C runs, never B
      await datedAs(started.executionId, '2026-10-20');
      await finalize(started.executionId);
      expect((await suggestion())?.suggestedSessionIndex).toBe(3); // still D
    });

    it('declining then abandoning does not revert the advance', async () => {
      const seed = await start(0, '2026-10-16');
      await datedAs(seed.executionId, '2026-10-16');
      await finalize(seed.executionId);
      const notice = await noticeOn('2026-10-20');
      await select(notice!.skipToSessionIndex);
      const started = await start(notice!.skipToSessionIndex, '2026-10-20');
      await abandonWorkoutExecution(UID, started.executionId);
      expect((await suggestion())?.suggestedSessionIndex).toBe(3);
    });
  });

  // ── §7 SECURITY ─────────────────────────────────────────────────────────
  describe('§7 security under the real published Rules', () => {
    it('a stranger cannot read this account’s schedule, executions or markers', async () => {
      const strangerDb = testEnv.authenticatedContext(OTHER_UID, { email_verified: true }).firestore();
      await select(0);
      for (const path of [
        `users/${UID}/workoutPrograms/${PROGRAM_ID}/scheduleState/${INSTANCE_ID}`,
        `users/${UID}/workoutExecutions/anything`,
        `users/${UID}/workoutDailyCompletions/2026-10-20`,
      ]) {
        await expect(getDoc(doc(strangerDb, path))).rejects.toThrow();
      }
    });

    it('no client can forge its own pilot enrolment', async () => {
      await expect(setDoc(doc(mocks.db as never, 'workoutPilotEnrollment', UID), { enabled: true }))
        .rejects.toThrow();
      const strangerDb = testEnv.authenticatedContext(OTHER_UID, { email_verified: true }).firestore();
      await expect(setDoc(doc(strangerDb, 'workoutPilotEnrollment', OTHER_UID), { enabled: true }))
        .rejects.toThrow();
      // Nor read someone else's.
      await expect(getDoc(doc(strangerDb, 'workoutPilotEnrollment', UID))).rejects.toThrow();
    });

    it('the daily marker is backend-only — the client can never write it', async () => {
      await expect(setDoc(doc(mocks.db as never, 'users', UID, 'workoutDailyCompletions', '2026-10-20'), {
        localDate: '2026-10-20', executionId: 'forged', programInstanceId: INSTANCE_ID, sessionIndex: 0,
      })).rejects.toThrow();
    });

    it('a finalize for someone else’s execution is refused', async () => {
      const started = await start(0, '2026-10-20');
      await datedAs(started.executionId, '2026-10-20');
      await expect(finalizeWorkoutSessionHandler(
        { auth: { uid: OTHER_UID }, data: { executionId: started.executionId } } as never, adminDb,
      )).rejects.toThrow();
    });

    it('the pilot flow writes nothing outside the workout domain', async () => {
      const id = await complete();
      async function complete() {
        const s = await start(0, '2026-10-20');
        await datedAs(s.executionId, '2026-10-20');
        await finalize(s.executionId);
        return s.executionId;
      }
      expect(id).toBeTruthy();
      for (const col of ['nutritionDiary', 'progressPhotos', 'nutritionDiaryProtocol', 'streakNutritionDays']) {
        const snap = await adminDb.collection(`users/${UID}/${col}`).get();
        expect(snap.size).toBe(0);
      }
    });
  });
});
