import {
  collection,
  doc,
  getDoc,
  getDocs,
  runTransaction,
  serverTimestamp,
  setDoc,
  type Timestamp,
} from 'firebase/firestore';

import { db } from '../lib/firebase';
import type { Weekday } from '../state/AppState';
// Imported from their concrete submodules, never the `../scheduleEngine`
// barrel — that barrel also re-exports `useWorkoutSchedule` (a React hook
// pulling in AuthContext/RN), which a pure Firestore service module must
// never drag in transitively (breaks Node-only test/tooling consumers).
import { detectMissedSessionGap, resolveWorkoutSchedule } from '../scheduleEngine/resolver';
import type {
  MissDecision,
  PendingMissDecision,
  ScheduleConfig,
  ScheduleEvent,
  ScheduleResolution,
} from '../scheduleEngine/types';

const USERS = 'users';
const PROGRAM_STATE = 'workoutProgramState';
const PROGRAMS = 'workoutPrograms';
const SCHEDULE_STATE = 'scheduleState';
const SCHEDULE_EVENTS = 'scheduleEvents';

const SCHEDULE_CONFIG_DOC_ID = 'scheduleConfig';
const SCHEDULE_STATE_DOC_ID = 'current';
const SCHEDULE_VERSION = 1;

export interface PersistedScheduleState {
  programId: string;
  nextSessionIndex: number;
  cursorDate: string;
  lastCompletedAt: string | null;
  pendingMissDecision: PendingMissDecision | null;
  updatedAt: Timestamp | null;
}

function scheduleConfigRef(uid: string) {
  return doc(db, USERS, uid, PROGRAM_STATE, SCHEDULE_CONFIG_DOC_ID);
}

function scheduleStateRef(uid: string, programId: string) {
  return doc(db, USERS, uid, PROGRAMS, programId, SCHEDULE_STATE, SCHEDULE_STATE_DOC_ID);
}

function scheduleEventsCollection(uid: string, programId: string) {
  return collection(db, USERS, uid, PROGRAMS, programId, SCHEDULE_EVENTS);
}

/** Deterministic — a retried write (double tap, network retry) lands on the same doc instead of duplicating the ledger (docs §36 Double tap/retry). */
function scheduleEventId(event: Pick<ScheduleEvent, 'type' | 'sessionIndex' | 'scheduledDate'>): string {
  return `${event.type.toLowerCase()}_${event.sessionIndex}_${event.scheduledDate}`;
}

export async function loadScheduleConfig(uid: string): Promise<ScheduleConfig | null> {
  const snapshot = await getDoc(scheduleConfigRef(uid));
  if (!snapshot.exists()) return null;
  const data = snapshot.data();
  if (!Array.isArray(data.trainingDays) || typeof data.timezone !== 'string') return null;
  return {
    trainingDays: data.trainingDays as Weekday[],
    timezone: data.timezone,
    scheduleVersion: typeof data.scheduleVersion === 'number' ? data.scheduleVersion : SCHEDULE_VERSION,
  };
}

/**
 * User preference — not program-scoped (docs §Alteração dos dias). Changing
 * it only affects future resolutions; it never rewrites past schedule events
 * and never regenerates the prescription.
 */
export async function saveScheduleConfig(uid: string, config: { trainingDays: Weekday[]; timezone: string }): Promise<void> {
  if (config.trainingDays.length === 0) throw new Error('SCHEDULE_CONFIG_REQUIRES_TRAINING_DAYS');
  await setDoc(scheduleConfigRef(uid), {
    trainingDays: config.trainingDays,
    timezone: config.timezone,
    scheduleVersion: SCHEDULE_VERSION,
    updatedAt: serverTimestamp(),
  });
}

/**
 * Bridges the Questionnaire's already-answered `trainingDays` into the
 * Schedule Engine automatically — the user must never be asked again for
 * something they already told the questionnaire (docs/workout-lifecycle/
 * 03_SCHEDULE_ENGINE.md). Called from `useWorkoutSchedule`'s own `reload()`
 * whenever it finds no `scheduleConfig` yet, mirroring the deterministic,
 * transaction-guarded idempotency `saveAndActivateWorkoutProgram` already
 * uses for the exact same class of problem (concurrent/double-mount
 * reconciliation attempts for the same uid).
 *
 * Create-only, via a transaction: if `scheduleConfig` already exists —
 * whether written by a previous reconciliation OR because the user
 * explicitly edited their days afterward via `saveScheduleConfig` — this
 * NEVER overwrites it; it just returns the existing value. Two concurrent
 * calls (e.g. `useWorkoutSchedule` mounting twice) race safely at the
 * Firestore transaction layer: whichever commits first creates the
 * document, the other's stale read is retried by the SDK and finds it
 * already there, so it also returns the existing value instead of writing
 * a second time.
 */
export async function ensureScheduleConfigFromQuestionnaire(
  uid: string,
  trainingDays: Weekday[],
  timezone: string,
): Promise<ScheduleConfig | null> {
  const ref = scheduleConfigRef(uid);
  return runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (snapshot.exists()) {
      const data = snapshot.data();
      if (!Array.isArray(data.trainingDays) || typeof data.timezone !== 'string') return null;
      return {
        trainingDays: data.trainingDays as Weekday[],
        timezone: data.timezone,
        scheduleVersion: typeof data.scheduleVersion === 'number' ? data.scheduleVersion : SCHEDULE_VERSION,
      };
    }
    const config = { trainingDays, timezone, scheduleVersion: SCHEDULE_VERSION };
    transaction.set(ref, { ...config, updatedAt: serverTimestamp() });
    return config;
  });
}

async function loadScheduleState(uid: string, programId: string): Promise<PersistedScheduleState | null> {
  const snapshot = await getDoc(scheduleStateRef(uid, programId));
  if (!snapshot.exists()) return null;
  const data = snapshot.data();
  if (data.programId !== programId) return null;
  return {
    programId,
    nextSessionIndex: data.nextSessionIndex,
    cursorDate: data.cursorDate,
    lastCompletedAt: data.lastCompletedAt ?? null,
    pendingMissDecision: data.pendingMissDecision ?? null,
    updatedAt: data.updatedAt ?? null,
  };
}

/**
 * Read + (if needed) first-detection write, then the pure resolution the UI
 * renders. The only mutation on a plain read is recording a *newly detected*
 * miss — never re-derived once persisted, so the decision is asked exactly
 * once (docs §35 Não perguntar repetidamente).
 */
export async function resolveTodaysSchedule(input: {
  uid: string;
  programId: string | null;
  sessionCount: number;
  activatedAtLocalDate: string | null;
  todayLocalDate: string;
}): Promise<ScheduleResolution> {
  const hasActiveProgram = input.programId != null && input.sessionCount > 0;
  const config = await loadScheduleConfig(input.uid);

  if (!hasActiveProgram) return resolveWorkoutSchedule({
    hasActiveProgram: false,
    sessionCount: 0,
    config,
    state: null,
    activatedAtLocalDate: input.todayLocalDate,
    todayLocalDate: input.todayLocalDate,
  });

  const programId = input.programId as string;
  const activatedAtLocalDate = input.activatedAtLocalDate ?? input.todayLocalDate;
  let state = await loadScheduleState(input.uid, programId);

  const resolverInput = {
    hasActiveProgram: true,
    sessionCount: input.sessionCount,
    config,
    state,
    activatedAtLocalDate,
    todayLocalDate: input.todayLocalDate,
  };

  const gap = detectMissedSessionGap(resolverInput);
  if (gap) {
    await runTransaction(db, async (transaction) => {
      const ref = scheduleStateRef(input.uid, programId);
      const current = await transaction.get(ref);
      // Re-check inside the transaction: a concurrent call may have already
      // recorded this gap (or the user may have completed the session in
      // the meantime), so never blindly overwrite.
      if (current.exists() && current.data().pendingMissDecision) return;
      const pendingMissDecision: PendingMissDecision = {
        missedSessionIndex: gap.missedSessionIndex,
        calendarSessionIndex: gap.calendarSessionIndex,
        missedScheduledDate: gap.missedScheduledDate,
        detectedOnDate: input.todayLocalDate,
      };
      if (current.exists()) {
        transaction.update(ref, { pendingMissDecision, updatedAt: serverTimestamp() });
      } else {
        transaction.set(ref, {
          programId,
          nextSessionIndex: gap.missedSessionIndex,
          cursorDate: activatedAtLocalDate,
          lastCompletedAt: null,
          pendingMissDecision,
          updatedAt: serverTimestamp(),
        });
      }
    });
    state = await loadScheduleState(input.uid, programId);
  }

  return resolveWorkoutSchedule({ ...resolverInput, state });
}

/**
 * Marks `sessionIndex` complete for `scheduledDate` and advances the
 * rotation. Rejected while a miss decision is pending — the UI must resolve
 * that first (docs §33/§34, decision is an event, not silently overridden).
 */
export async function completeScheduledSession(input: {
  uid: string;
  programId: string;
  sessionIndex: number;
  sessionCount: number;
  scheduledLocalDate: string;
}): Promise<void> {
  const eventRef = doc(
    scheduleEventsCollection(input.uid, input.programId),
    scheduleEventId({ type: 'COMPLETED', sessionIndex: input.sessionIndex, scheduledDate: input.scheduledLocalDate }),
  );
  const stateRef = scheduleStateRef(input.uid, input.programId);

  await runTransaction(db, async (transaction) => {
    const [eventSnapshot, stateSnapshot] = await Promise.all([
      transaction.get(eventRef),
      transaction.get(stateRef),
    ]);
    if (eventSnapshot.exists()) return; // idempotent retry — already recorded.

    const current = stateSnapshot.exists() ? stateSnapshot.data() : null;
    if (current?.pendingMissDecision) throw new Error('MISSED_SESSION_DECISION_PENDING');
    const expectedIndex = current?.nextSessionIndex ?? 0;
    if (input.sessionIndex !== expectedIndex) throw new Error('SESSION_INDEX_OUT_OF_SEQUENCE');

    transaction.set(eventRef, {
      type: 'COMPLETED',
      sessionIndex: input.sessionIndex,
      scheduledDate: input.scheduledLocalDate,
      occurredAt: serverTimestamp(),
    });
    transaction.set(stateRef, {
      programId: input.programId,
      nextSessionIndex: (input.sessionIndex + 1) % input.sessionCount,
      cursorDate: input.scheduledLocalDate,
      lastCompletedAt: input.scheduledLocalDate,
      pendingMissDecision: null,
      updatedAt: serverTimestamp(),
    });
  });
}

/**
 * Resolves a pending MISSED_SESSION_DECISION_REQUIRED. `CONTINUE_SEQUENCE`
 * leaves `nextSessionIndex` on the missed session (today performs it, cursor
 * jumps to today once that completion lands); `FOLLOW_SCHEDULE` records the
 * skipped session(s) and jumps the cursor straight to today's calendar slot.
 * Re-running with nothing pending is a no-op (idempotent retry).
 */
export async function resolveMissedSession(input: {
  uid: string;
  programId: string;
  sessionCount: number;
  decision: MissDecision;
  todayLocalDate: string;
}): Promise<void> {
  const stateRef = scheduleStateRef(input.uid, input.programId);

  await runTransaction(db, async (transaction) => {
    const stateSnapshot = await transaction.get(stateRef);
    if (!stateSnapshot.exists()) return;
    const data = stateSnapshot.data();
    const pending = data.pendingMissDecision as PendingMissDecision | null;
    if (!pending) return; // already resolved — idempotent retry.

    const resolvedEventRef = doc(
      scheduleEventsCollection(input.uid, input.programId),
      scheduleEventId({ type: 'MISS_RESOLVED', sessionIndex: pending.missedSessionIndex, scheduledDate: pending.missedScheduledDate }),
    );
    transaction.set(resolvedEventRef, {
      type: 'MISS_RESOLVED',
      sessionIndex: pending.missedSessionIndex,
      scheduledDate: pending.missedScheduledDate,
      decision: input.decision,
      occurredAt: serverTimestamp(),
    });

    if (input.decision === 'CONTINUE_SEQUENCE') {
      transaction.set(stateRef, {
        ...data,
        pendingMissDecision: null,
        updatedAt: serverTimestamp(),
      });
      return;
    }

    // FOLLOW_SCHEDULE: every session strictly between the missed one and the
    // calendar target is also skipped — not just the first — so the ledger
    // reflects the whole gap (docs §37 Múltiplos dias perdidos).
    let index = pending.missedSessionIndex;
    while (index !== pending.calendarSessionIndex) {
      const skippedRef = doc(
        scheduleEventsCollection(input.uid, input.programId),
        scheduleEventId({ type: 'SKIPPED', sessionIndex: index, scheduledDate: input.todayLocalDate }),
      );
      transaction.set(skippedRef, {
        type: 'SKIPPED',
        sessionIndex: index,
        scheduledDate: input.todayLocalDate,
        reasonCode: 'FOLLOWED_SCHEDULE_AFTER_MISS',
        occurredAt: serverTimestamp(),
      });
      index = (index + 1) % input.sessionCount;
    }

    transaction.set(stateRef, {
      programId: input.programId,
      nextSessionIndex: pending.calendarSessionIndex,
      cursorDate: input.todayLocalDate,
      lastCompletedAt: data.lastCompletedAt ?? null,
      pendingMissDecision: null,
      updatedAt: serverTimestamp(),
    });
  });
}

/** Diagnostics/QA only — not on any hot path. */
export async function listScheduleEvents(uid: string, programId: string): Promise<ScheduleEvent[]> {
  const snapshot = await getDocs(scheduleEventsCollection(uid, programId));
  return snapshot.docs.map((item) => item.data() as ScheduleEvent);
}
