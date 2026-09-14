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
import {
  authorizeWorkoutLifecycleMutation,
  WORKOUT_LIFECYCLE_AUTHORITY_GRANT_ID,
} from '../workoutLifecycle/authorityProvider';
import type { Weekday } from '../state/AppState';
// Imported from their concrete submodules, never the `../scheduleEngine`
// barrel — that barrel also re-exports `useWorkoutSchedule` (a React hook
// pulling in AuthContext/RN), which a pure Firestore service module must
// never drag in transitively (breaks Node-only test/tooling consumers).
import { addDaysLocal } from '../scheduleEngine/calendar';
import { scheduleEventDocumentId } from '../scheduleEngine/identities';
import { detectMissedSessionGap, initialSessionIndexFor, resolveWorkoutSchedule } from '../scheduleEngine/resolver';
import {
  pendingMissMatchesGap,
  reconcilePendingMissDecision,
} from '../scheduleEngine/pendingMissReconciliation';
import type {
  MissDecision,
  MissedSessionDecisionIdentity,
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
  programInstanceId?: string;
  nextSessionIndex: number;
  cursorDate: string;
  lastCompletedAt: string | null;
  pendingMissDecision: PendingMissDecision | null;
  updatedAt: Timestamp | null;
}

function scheduleConfigRef(uid: string) {
  return doc(db, USERS, uid, PROGRAM_STATE, SCHEDULE_CONFIG_DOC_ID);
}

function scheduleStateRef(uid: string, programId: string, programInstanceId?: string) {
  return doc(db, USERS, uid, PROGRAMS, programId, SCHEDULE_STATE, programInstanceId ?? SCHEDULE_STATE_DOC_ID);
}

function scheduleEventsCollection(uid: string, programId: string) {
  return collection(db, USERS, uid, PROGRAMS, programId, SCHEDULE_EVENTS);
}

/** Deterministic — a retried write (double tap, network retry) lands on the same doc instead of duplicating the ledger (docs §36 Double tap/retry). */
function scheduleEventId(event: Pick<ScheduleEvent, 'type' | 'sessionIndex' | 'scheduledDate'>, programInstanceId?: string): string {
  return scheduleEventDocumentId({ ...event, ...(programInstanceId ? { programInstanceId } : {}) });
}

/** Read-only durable fact used by cold-start completion recovery. */
export async function hasScheduledSessionCompletion(input: {
  uid: string;
  programId: string;
  programInstanceId?: string;
  sessionIndex: number;
  scheduledLocalDate: string;
}): Promise<boolean> {
  const snapshot = await getDoc(doc(
    scheduleEventsCollection(input.uid, input.programId),
    scheduleEventId(
      { type: 'COMPLETED', sessionIndex: input.sessionIndex, scheduledDate: input.scheduledLocalDate },
      input.programInstanceId,
    ),
  ));
  return snapshot.exists();
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

async function loadScheduleState(uid: string, programId: string, programInstanceId?: string): Promise<PersistedScheduleState | null> {
  const snapshot = await getDoc(scheduleStateRef(uid, programId, programInstanceId));
  if (!snapshot.exists()) return null;
  const data = snapshot.data();
  if (data.programId !== programId) return null;
  return {
    programId,
    ...(typeof data.programInstanceId === 'string' ? { programInstanceId: data.programInstanceId } : {}),
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
  programInstanceId?: string | null;
  sessionCount: number;
  activatedAtLocalDate: string | null;
  todayLocalDate: string;
  /** Phase 2 program-scoped training days. Legacy programs omit this and use ScheduleConfig unchanged. */
  trainingDaysOverride?: Weekday[];
  activeRecoveryDaysOverride?: Weekday[];
}): Promise<ScheduleResolution> {
  const hasActiveProgram = input.programId != null && input.sessionCount > 0;
  const storedConfig = await loadScheduleConfig(input.uid);
  const config = storedConfig && input.trainingDaysOverride?.length
    ? {
        ...storedConfig,
        trainingDays: input.trainingDaysOverride,
        activeRecoveryDays: input.activeRecoveryDaysOverride ?? [],
      }
    : storedConfig;

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
  let state = await loadScheduleState(input.uid, programId, input.programInstanceId ?? undefined);

  const resolverInput = {
    hasActiveProgram: true,
    sessionCount: input.sessionCount,
    config,
    state,
    activatedAtLocalDate,
    todayLocalDate: input.todayLocalDate,
  };

  // A pending payload is persisted so the question survives restarts, but
  // the schedule or lifecycle may have changed since it was detected. The
  // backend deliberately recomputes the gap and rejects stale payloads;
  // converge the client state to that same current calendar before showing
  // the modal, otherwise the user is trapped in a decision that can never
  // be accepted (`no_pending_missed_session_decision`).
  if (state?.pendingMissDecision) {
    const currentGap = detectMissedSessionGap({
      ...resolverInput,
      state: { ...state, pendingMissDecision: null },
    });
    if (!pendingMissMatchesGap(state.pendingMissDecision, currentGap)) {
      await runTransaction(db, async (transaction) => {
        const ref = scheduleStateRef(input.uid, programId, input.programInstanceId ?? undefined);
        const current = await transaction.get(ref);
        if (!current.exists()) return;
        const data = current.data();
        const currentPending = data.pendingMissDecision as PendingMissDecision | null;
        if (!currentPending) return;
        const currentState = {
          nextSessionIndex: data.nextSessionIndex as number,
          cursorDate: data.cursorDate as string,
          lastCompletedAt: (data.lastCompletedAt as string | null) ?? null,
          pendingMissDecision: null,
        };
        const recalculatedGap = detectMissedSessionGap({ ...resolverInput, state: currentState });
        const reconciled = reconcilePendingMissDecision(
          currentPending,
          recalculatedGap,
          input.todayLocalDate,
        );
        if (reconciled === currentPending) return;
        transaction.update(ref, { pendingMissDecision: reconciled, updatedAt: serverTimestamp() });
      });
      state = await loadScheduleState(input.uid, programId, input.programInstanceId ?? undefined);
    }
  }

  // `detectMissedSessionGap` is a pure calendar walk — it doesn't know
  // whether THIS exact gap (same sessionIndex + first occurrence) already
  // got a decision. Before persisting anything, check the ledger via the
  // very same deterministic id `resolveMissedSession` writes on
  // CONTINUE_SEQUENCE/FOLLOW_SCHEDULE (docs §Decisão idempotente) — a
  // single targeted read, no scan, no second source of truth. If it's
  // already there, this is not a NEW gap to ask about; it's the same
  // pending session still not done, and `resolveWorkoutSchedule` below
  // (given `resolvedMissScheduledDate`) reports it as SESSION_READY instead
  // of re-deriving MISSED_SESSION_DECISION_REQUIRED forever.
  const gap = detectMissedSessionGap(resolverInput);
  let resolvedMissScheduledDate: string | null = null;
  if (gap) {
    const alreadyResolvedSnapshot = await getDoc(doc(
      scheduleEventsCollection(input.uid, programId),
      scheduleEventId({ type: 'MISS_RESOLVED', sessionIndex: gap.missedSessionIndex, scheduledDate: gap.missedScheduledDate }, input.programInstanceId ?? undefined),
    ));
    if (alreadyResolvedSnapshot.exists()) {
      resolvedMissScheduledDate = gap.missedScheduledDate;
    } else {
      await runTransaction(db, async (transaction) => {
        const ref = scheduleStateRef(input.uid, programId, input.programInstanceId ?? undefined);
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
            ...(input.programInstanceId ? { programInstanceId: input.programInstanceId } : {}),
            nextSessionIndex: gap.missedSessionIndex,
            cursorDate: activatedAtLocalDate,
            lastCompletedAt: null,
            pendingMissDecision,
            updatedAt: serverTimestamp(),
          });
        }
      });
      state = await loadScheduleState(input.uid, programId, input.programInstanceId ?? undefined);
    }
  }

  return resolveWorkoutSchedule({ ...resolverInput, state, resolvedMissScheduledDate });
}

/**
 * Marks `sessionIndex` complete for `scheduledDate` and advances the
 * rotation. Rejected while a miss decision is pending — the UI must resolve
 * that first (docs §33/§34, decision is an event, not silently overridden).
 */
export interface CompleteScheduledSessionInput {
  uid: string;
  programId: string;
  programInstanceId?: string;
  sessionIndex: number;
  sessionCount: number;
  scheduledLocalDate: string;
  /**
   * Required to derive the expected first-ever session when no
   * `ScheduleState` exists yet (see `expectedIndex` below) — the exact same
   * `trainingDays`/`activatedAtLocalDate` the caller's own
   * `resolveWorkoutSchedule` read used to decide `SESSION_READY` in the
   * first place. Deliberately required (not optional with a silent
   * fallback) — an omitted value must fail loudly at the call site instead
   * of resurrecting the `?? 0` bug this replaces (docs — regression: a
   * ProgramInstance activating on a trainingDay that isn't the first in the
   * ordered list anchors its first session to a non-zero index; treating a
   * missing value as "assume session 0" reintroduces the exact defect).
   */
  trainingDays: readonly Weekday[];
  activatedAtLocalDate: string;
}

const scheduledSessionCompletionsInFlight = new Map<string, Promise<void>>();

function scheduledSessionCompletionKey(input: CompleteScheduledSessionInput): string {
  return [
    input.uid,
    input.programId,
    input.programInstanceId ?? 'legacy',
    input.sessionIndex,
    input.scheduledLocalDate,
  ].join(':');
}

/**
 * Single-flight is scoped to one exact durable Schedule fact. This prevents a
 * foreground recovery and an explicit retry from racing for the one-time
 * lifecycle grant, while a settled failure is always evicted for later retry.
 */
export function completeScheduledSession(input: CompleteScheduledSessionInput): Promise<void> {
  const key = scheduledSessionCompletionKey(input);
  const existing = scheduledSessionCompletionsInFlight.get(key);
  if (existing) return existing;

  const operation = completeScheduledSessionAttempt(input);
  scheduledSessionCompletionsInFlight.set(key, operation);
  const release = () => {
    if (scheduledSessionCompletionsInFlight.get(key) === operation) {
      scheduledSessionCompletionsInFlight.delete(key);
    }
  };
  void operation.then(release, release);
  return operation;
}

async function completeScheduledSessionAttempt(input: CompleteScheduledSessionInput): Promise<void> {
  const eventRef = doc(
    scheduleEventsCollection(input.uid, input.programId),
    scheduleEventId({ type: 'COMPLETED', sessionIndex: input.sessionIndex, scheduledDate: input.scheduledLocalDate }, input.programInstanceId),
  );
  const stateRef = scheduleStateRef(input.uid, input.programId, input.programInstanceId);

  // Response-loss recovery: if the transaction committed but its response was
  // lost, the immutable event is sufficient authority for idempotent success.
  // Do this before requesting a fresh one-time grant.
  if ((await getDoc(eventRef)).exists()) return;

  if (input.programInstanceId) {
    await authorizeWorkoutLifecycleMutation({
      operation: 'COMPLETE_SCHEDULE',
      sourceProgramInstanceId: input.programInstanceId,
      scheduledLocalDate: input.scheduledLocalDate,
      sessionIndex: input.sessionIndex,
    });
  }
  const grantRef = doc(
    db, 'users', input.uid, 'workoutLifecycleAuthorityGrants', WORKOUT_LIFECYCLE_AUTHORITY_GRANT_ID,
  );

  await runTransaction(db, async (transaction) => {
    const [eventSnapshot, stateSnapshot] = await Promise.all([
      transaction.get(eventRef),
      transaction.get(stateRef),
    ]);
    if (eventSnapshot.exists()) {
      if (input.programInstanceId) transaction.delete(grantRef);
      return; // idempotent retry — already recorded.
    }

    const current = stateSnapshot.exists() ? stateSnapshot.data() : null;
    if (current?.pendingMissDecision) throw new Error('MISSED_SESSION_DECISION_PENDING');
    // No ScheduleState yet means this is the account's first-ever
    // completion — the expected session is whatever the Schedule Engine
    // itself anchors to for this exact date (`initialSessionIndexFor`, the
    // same derivation `resolveWorkoutSchedule` used to return SESSION_READY
    // in the first place), never a hardcoded 0. A program that activates on
    // a non-first trainingDay legitimately opens on a session other than 0.
    const expectedIndex = current?.nextSessionIndex ?? initialSessionIndexFor({
      trainingDays: input.trainingDays,
      activatedAtLocalDate: input.activatedAtLocalDate,
      todayLocalDate: input.scheduledLocalDate,
      sessionCount: input.sessionCount,
    });
    if (input.sessionIndex !== expectedIndex) throw new Error('SESSION_INDEX_OUT_OF_SEQUENCE');

    transaction.set(eventRef, {
      type: 'COMPLETED',
      ...(input.programInstanceId ? { programInstanceId: input.programInstanceId } : {}),
      sessionIndex: input.sessionIndex,
      scheduledDate: input.scheduledLocalDate,
      occurredAt: serverTimestamp(),
    });
    transaction.set(stateRef, {
      programId: input.programId,
      ...(input.programInstanceId ? { programInstanceId: input.programInstanceId } : {}),
      nextSessionIndex: (input.sessionIndex + 1) % input.sessionCount,
      cursorDate: input.scheduledLocalDate,
      lastCompletedAt: input.scheduledLocalDate,
      pendingMissDecision: null,
      updatedAt: serverTimestamp(),
    });
    if (input.programInstanceId) transaction.delete(grantRef);
  });
}

/**
 * Resolves a pending MISSED_SESSION_DECISION_REQUIRED. `CONTINUE_SEQUENCE`
 * leaves `nextSessionIndex` on the missed session (today performs it, cursor
 * jumps to today once that completion lands); `FOLLOW_SCHEDULE` records the
 * skipped session(s) and jumps the cursor straight to today's calendar slot.
 * Re-running is a no-op only when the immutable event proves the same
 * occurrence already received the same choice (idempotent retry).
 */
export async function resolveMissedSession(input: {
  uid: string;
  programId: string;
  programInstanceId?: string;
  sessionCount: number;
  decision: MissDecision;
  todayLocalDate: string;
  expected: MissedSessionDecisionIdentity;
}): Promise<void> {
  const stateRef = scheduleStateRef(input.uid, input.programId, input.programInstanceId);
  const resolvedEventRef = doc(
    scheduleEventsCollection(input.uid, input.programId),
    scheduleEventId({
      type: 'MISS_RESOLVED',
      sessionIndex: input.expected.missedSessionIndex,
      scheduledDate: input.expected.missedScheduledDate,
    }, input.programInstanceId),
  );

  // Response-loss/idempotent retry: the immutable event proves both which
  // occurrence was resolved and which choice won. Do this before asking for
  // another one-time authority grant.
  const existingEvent = await getDoc(resolvedEventRef);
  if (existingEvent.exists()) {
    if (existingEvent.data().decision === input.decision) return;
    throw new Error('STALE_MISSED_SESSION_DECISION');
  }

  if (input.programInstanceId) {
    await authorizeWorkoutLifecycleMutation({
      operation: 'RESOLVE_MISSED_SESSION',
      sourceProgramInstanceId: input.programInstanceId,
      scheduledLocalDate: input.todayLocalDate,
      decision: input.decision,
      expectedMissedSessionIndex: input.expected.missedSessionIndex,
      expectedCalendarSessionIndex: input.expected.calendarSessionIndex,
      expectedMissedScheduledDate: input.expected.missedScheduledDate,
    });
  }
  const grantRef = doc(
    db, 'users', input.uid, 'workoutLifecycleAuthorityGrants', WORKOUT_LIFECYCLE_AUTHORITY_GRANT_ID,
  );

  await runTransaction(db, async (transaction) => {
    const [stateSnapshot, eventSnapshot] = await Promise.all([
      transaction.get(stateRef),
      transaction.get(resolvedEventRef),
    ]);
    if (!stateSnapshot.exists()) {
      if (eventSnapshot.exists() && eventSnapshot.data().decision === input.decision) {
        if (input.programInstanceId) transaction.delete(grantRef);
        return;
      }
      throw new Error('STALE_MISSED_SESSION_DECISION');
    }
    const data = stateSnapshot.data();
    const pending = data.pendingMissDecision as PendingMissDecision | null;
    if (!pending) {
      if (eventSnapshot.exists() && eventSnapshot.data().decision === input.decision) {
        if (input.programInstanceId) transaction.delete(grantRef);
        return;
      }
      throw new Error('STALE_MISSED_SESSION_DECISION');
    }
    if (!pendingMissMatchesGap(pending, input.expected)) {
      // A new pending decision must never receive the old modal's choice.
      throw new Error('STALE_MISSED_SESSION_DECISION');
    }

    transaction.set(resolvedEventRef, {
      type: 'MISS_RESOLVED',
      ...(input.programInstanceId ? { programInstanceId: input.programInstanceId } : {}),
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
      if (input.programInstanceId) transaction.delete(grantRef);
      return;
    }

    // FOLLOW_SCHEDULE: every session strictly between the missed one and the
    // calendar target is also skipped — not just the first — so the ledger
    // reflects the whole gap (docs §37 Múltiplos dias perdidos).
    let index = pending.missedSessionIndex;
    while (index !== pending.calendarSessionIndex) {
      const skippedRef = doc(
        scheduleEventsCollection(input.uid, input.programId),
        scheduleEventId({ type: 'SKIPPED', sessionIndex: index, scheduledDate: input.todayLocalDate }, input.programInstanceId),
      );
      transaction.set(skippedRef, {
        type: 'SKIPPED',
        ...(input.programInstanceId ? { programInstanceId: input.programInstanceId } : {}),
        sessionIndex: index,
        scheduledDate: input.todayLocalDate,
        reasonCode: 'FOLLOWED_SCHEDULE_AFTER_MISS',
        occurredAt: serverTimestamp(),
      });
      index = (index + 1) % input.sessionCount;
    }

    transaction.set(stateRef, {
      programId: input.programId,
      ...(input.programInstanceId ? { programInstanceId: input.programInstanceId } : {}),
      nextSessionIndex: pending.calendarSessionIndex,
      // The day BEFORE today, never today itself: `cursorDate` means "every
      // trainingDay up to and including this date is already accounted
      // for" (docs §Ancoragem inicial uses the same "day before" convention
      // for a fresh program). FOLLOW_SCHEDULE only accounts for the SKIPPED
      // sessions strictly before `calendarSessionIndex` — that session
      // itself is what's newly due, not yet resolved. Setting cursorDate to
      // `todayLocalDate` here made `trainingDayOccurrences`'s exclusive walk
      // treat today as already consumed, so the very next resolve (even
      // seconds later, same day) collapsed straight to REST_DAY instead of
      // offering `calendarSessionIndex` — the bug this comment guards
      // against regressing.
      cursorDate: addDaysLocal(input.todayLocalDate, -1),
      lastCompletedAt: data.lastCompletedAt ?? null,
      pendingMissDecision: null,
      updatedAt: serverTimestamp(),
    });
    if (input.programInstanceId) transaction.delete(grantRef);
  });
}

/** Diagnostics/QA only — not on any hot path. */
export async function listScheduleEvents(uid: string, programId: string): Promise<ScheduleEvent[]> {
  const snapshot = await getDocs(scheduleEventsCollection(uid, programId));
  return snapshot.docs.map((item) => item.data() as ScheduleEvent);
}
