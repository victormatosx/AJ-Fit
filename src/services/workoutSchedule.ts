import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  where,
  type Timestamp,
} from 'firebase/firestore';

import { db } from '../lib/firebase';
import { countFirestoreRead } from '../lib/perf';
import {
  authorizeWorkoutLifecycleMutation,
  WORKOUT_LIFECYCLE_AUTHORITY_GRANT_ID,
} from '../workoutLifecycle/authorityProvider';
import type { ScheduleMode, Weekday } from '../state/AppState';
// Imported from their concrete submodules, never the `../scheduleEngine`
// barrel — that barrel also re-exports `useWorkoutSchedule` (a React hook
// pulling in AuthContext/RN), which a pure Firestore service module must
// never drag in transitively (breaks Node-only test/tooling consumers).
import { addDaysLocal } from '../scheduleEngine/calendar';
import { scheduleEventDocumentId } from '../scheduleEngine/identities';
import { detectMissedSessionGap, resolveWorkoutSchedule } from '../scheduleEngine/resolver';
import { repositionedSessionIndexes } from '../scheduleEngine/reposition';
import {
  readSessionSuggestion,
  selectSession,
  type SessionSuggestion,
} from '../scheduleEngine/sessionSuggestion';
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
  /** New training model. Absent on every document written before selection existed. */
  suggestedSessionIndex?: number;
  suggestionVersion?: number;
  lastSelectedSessionIndex?: number | null;
  cursorDate: string;
  lastCompletedAt: string | null;
  /** Absent on documents written before the field existed — see `ScheduleState`. */
  lastPerformedLocalDate?: string | null;
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
  occurrence?: number;
}): Promise<boolean> {
  const baseId = scheduleEventId(
    { type: 'COMPLETED', sessionIndex: input.sessionIndex, scheduledDate: input.scheduledLocalDate },
    input.programInstanceId,
  );
  const eventId = (input.occurrence ?? 1) > 1 ? `${baseId}_o${input.occurrence}` : baseId;
  const snapshot = await getDoc(doc(
    scheduleEventsCollection(input.uid, input.programId),
    eventId,
  ));
  return snapshot.exists();
}

export async function loadScheduleConfig(uid: string): Promise<ScheduleConfig | null> {
  countFirestoreRead('workout_schedule.config');
  const snapshot = await getDoc(scheduleConfigRef(uid));
  if (!snapshot.exists()) return null;
  const data = snapshot.data();
  if (!Array.isArray(data.trainingDays) || typeof data.timezone !== 'string') return null;
  return {
    scheduleMode: data.scheduleMode === 'flexible' ? 'flexible' : 'fixed',
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
export async function saveScheduleConfig(uid: string, config: { scheduleMode?: ScheduleMode; trainingDays: Weekday[]; timezone: string }): Promise<void> {
  const scheduleMode = config.scheduleMode ?? 'fixed';
  if (scheduleMode === 'fixed' && config.trainingDays.length === 0) throw new Error('SCHEDULE_CONFIG_REQUIRES_TRAINING_DAYS');
  if (scheduleMode === 'flexible' && config.trainingDays.length !== 0) throw new Error('FLEXIBLE_SCHEDULE_CANNOT_HAVE_TRAINING_DAYS');
  await setDoc(scheduleConfigRef(uid), {
    scheduleMode,
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
  scheduleMode: ScheduleMode = 'fixed',
): Promise<ScheduleConfig | null> {
  const ref = scheduleConfigRef(uid);
  return runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (snapshot.exists()) {
      const data = snapshot.data();
      if (!Array.isArray(data.trainingDays) || typeof data.timezone !== 'string') return null;
      return {
        scheduleMode: data.scheduleMode === 'flexible' ? 'flexible' : 'fixed',
        trainingDays: data.trainingDays as Weekday[],
        timezone: data.timezone,
        scheduleVersion: typeof data.scheduleVersion === 'number' ? data.scheduleVersion : SCHEDULE_VERSION,
      };
    }
    if ((scheduleMode === 'fixed' && trainingDays.length === 0)
      || (scheduleMode === 'flexible' && trainingDays.length !== 0)) return null;
    const config = { scheduleMode, trainingDays, timezone, scheduleVersion: SCHEDULE_VERSION };
    transaction.set(ref, { ...config, updatedAt: serverTimestamp() });
    return config;
  });
}

/**
 * Raw rotation state for the suggestion layer.
 *
 * Exported because the new resolver is pure over the stored document and the
 * hook needs it directly — `resolveTodaysSchedule` used to be the only reader,
 * and it also performed the miss-detection write that the new model removed.
 */
export async function loadScheduleSuggestionState(
  uid: string, programId: string, programInstanceId?: string,
): Promise<PersistedScheduleState | null> {
  return loadScheduleState(uid, programId, programInstanceId);
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
    ...(Number.isInteger(data.suggestedSessionIndex) ? { suggestedSessionIndex: data.suggestedSessionIndex } : {}),
    ...(Number.isInteger(data.suggestionVersion) ? { suggestionVersion: data.suggestionVersion } : {}),
    lastSelectedSessionIndex: Number.isInteger(data.lastSelectedSessionIndex) ? data.lastSelectedSessionIndex : null,
    cursorDate: data.cursorDate,
    lastCompletedAt: data.lastCompletedAt ?? null,
    lastPerformedLocalDate: data.lastPerformedLocalDate ?? null,
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
  scheduleMode?: ScheduleMode;
  activatedAtLocalDate: string | null;
  todayLocalDate: string;
  /** Phase 2 program-scoped training days. Legacy programs omit this and use ScheduleConfig unchanged. */
  trainingDaysOverride?: Weekday[];
  activeRecoveryDaysOverride?: Weekday[];
  /**
   * Caller-provided result of its own already-awaited `loadScheduleConfig`
   * call, when it has one (`useWorkoutSchedule.reload()` always does) — skips
   * this function's own read of the exact same document. `undefined` (the
   * only other caller-visible state, e.g. direct/test callers) keeps the
   * original behavior of fetching it here. An explicit `null` means "already
   * checked, there is none" and is honored as-is, never re-fetched.
   */
  storedConfig?: ScheduleConfig | null;
}): Promise<ScheduleResolution> {
  const hasActiveProgram = input.programId != null && input.sessionCount > 0;
  const storedConfig = input.storedConfig !== undefined ? input.storedConfig : await loadScheduleConfig(input.uid);
  const scheduleMode = input.scheduleMode ?? storedConfig?.scheduleMode ?? 'fixed';
  const config = storedConfig
    ? {
        ...storedConfig,
        scheduleMode,
        ...(input.trainingDaysOverride?.length ? { trainingDays: input.trainingDaysOverride } : {}),
        ...(input.activeRecoveryDaysOverride
          ? { activeRecoveryDays: input.activeRecoveryDaysOverride }
          : {}),
      }
    : null;

  if (!hasActiveProgram) return resolveWorkoutSchedule({
    hasActiveProgram: false,
    sessionCount: 0,
    scheduleMode,
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
    scheduleMode,
    config,
    state,
    activatedAtLocalDate,
    todayLocalDate: input.todayLocalDate,
  };

  // Flexible plans never accrue weekday debt. Returning before every
  // reconciliation/ledger read guarantees idle time cannot create a pending
  // miss, a missed decision, or SKIPPED events.
  if (scheduleMode === 'flexible') return resolveWorkoutSchedule(resolverInput);

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
          lastPerformedLocalDate: (data.lastPerformedLocalDate as string | null) ?? null,
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
            lastPerformedLocalDate: null,
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
      lastPerformedLocalDate: data.lastPerformedLocalDate ?? null,
      pendingMissDecision: null,
      updatedAt: serverTimestamp(),
    });
    if (input.programInstanceId) transaction.delete(grantRef);
  });
}

/**
 * Manual sequence reposition (docs §Escolha manual de treino): the user
 * picked a session other than the one automatically offered, and that
 * session becomes the new rotation anchor going forward — never a one-off,
 * out-of-sequence session. Mirrors `resolveMissedSession`'s FOLLOW_SCHEDULE
 * branch byte-for-byte (one ledger event per session walked past, same
 * "day before" `cursorDate` convention), except the ledger entries are
 * `REPOSITIONED` — never `SKIPPED` — so adherence/streak (which only ever
 * counts `COMPLETED` events) is entirely unaffected by a deliberate manual
 * reorder. Also unconditionally resolves any `pendingMissDecision` (docs
 * decision #5): the user's explicit choice already represents their
 * intent, so this never re-asks "recover or skip" first.
 */
export async function repositionScheduleCursor(input: {
  uid: string;
  programId: string;
  programInstanceId?: string;
  sessionCount: number;
  scheduleMode: ScheduleMode;
  targetSessionIndex: number;
  todayLocalDate: string;
  /** The rotation's current effective next session, as the caller's own already-resolved `ScheduleResolution` sees it — never re-derived here. */
  expectedCurrentNextSessionIndex: number;
}): Promise<void> {
  const repositionedIndexes = repositionedSessionIndexes(
    input.expectedCurrentNextSessionIndex,
    input.targetSessionIndex,
    input.sessionCount,
  );
  const stateRef = scheduleStateRef(input.uid, input.programId, input.programInstanceId);

  // Idempotent retry / already-applied (double tap, redelivered call):
  // nothing left to do.
  const precheck = await getDoc(stateRef);
  if (precheck.exists()) {
    const precheckData = precheck.data();
    if (precheckData.nextSessionIndex === input.targetSessionIndex && !precheckData.pendingMissDecision) return;
  }

  if (input.programInstanceId) {
    await authorizeWorkoutLifecycleMutation({
      operation: 'REPOSITION_SCHEDULE_CURSOR',
      sourceProgramInstanceId: input.programInstanceId,
      scheduledLocalDate: input.todayLocalDate,
      targetSessionIndex: input.targetSessionIndex,
      expectedCurrentNextSessionIndex: input.expectedCurrentNextSessionIndex,
    });
  }
  const grantRef = doc(
    db, 'users', input.uid, 'workoutLifecycleAuthorityGrants', WORKOUT_LIFECYCLE_AUTHORITY_GRANT_ID,
  );

  let staleCursor = false;
  try {
    await runTransaction(db, async (transaction) => {
      const stateSnapshot = await transaction.get(stateRef);
      const data = stateSnapshot.exists() ? stateSnapshot.data() : null;
      if (data && data.nextSessionIndex === input.targetSessionIndex && !data.pendingMissDecision) {
        if (input.programInstanceId) transaction.delete(grantRef);
        return;
      }
      // Close the grant-to-transaction race: the backend authorized the exact
      // cursor the caller saw, but another device may have advanced it before
      // this transaction acquired its snapshot. Never overwrite that newer
      // cursor with the stale target. Consume the one-time grant and fail after
      // the cleanup commit so it cannot remain reusable for its remaining TTL.
      if (data && data.nextSessionIndex !== input.expectedCurrentNextSessionIndex) {
        staleCursor = true;
        if (input.programInstanceId) transaction.delete(grantRef);
        return;
      }

      for (const index of repositionedIndexes) {
        const repositionedRef = doc(
          scheduleEventsCollection(input.uid, input.programId),
          scheduleEventId({ type: 'REPOSITIONED', sessionIndex: index, scheduledDate: input.todayLocalDate }, input.programInstanceId),
        );
        transaction.set(repositionedRef, {
          type: 'REPOSITIONED',
          ...(input.programInstanceId ? { programInstanceId: input.programInstanceId } : {}),
          sessionIndex: index,
          scheduledDate: input.todayLocalDate,
          occurredAt: serverTimestamp(),
        });
      }

      // Same "day before" convention FOLLOW_SCHEDULE already uses in fixed
      // mode (`resolveMissedSession` above), so the very next resolve doesn't
      // collapse today's just-chosen session into REST_DAY/TODAY_COMPLETED.
      // Flexible never reads `cursorDate` to decide readiness, so today is a
      // safe, semantically coherent value there.
      const targetCursorDate = input.scheduleMode === 'flexible'
        ? input.todayLocalDate
        : addDaysLocal(input.todayLocalDate, -1);

      transaction.set(stateRef, {
        programId: input.programId,
        ...(input.programInstanceId ? { programInstanceId: input.programInstanceId } : {}),
        nextSessionIndex: input.targetSessionIndex,
        cursorDate: targetCursorDate,
        lastCompletedAt: data?.lastCompletedAt ?? null,
        lastPerformedLocalDate: data?.lastPerformedLocalDate ?? null,
        pendingMissDecision: null,
        updatedAt: serverTimestamp(),
      });
      if (input.programInstanceId) transaction.delete(grantRef);
    });
  } catch (error) {
    if (input.programInstanceId) await deleteDoc(grantRef).catch(() => undefined);
    throw error;
  }
  if (staleCursor) throw new Error('STALE_SCHEDULE_CURSOR');
}

/**
 * Persists an intentional session choice (new training model).
 *
 * This is the ONLY client write that moves the rotation now, and it is
 * deliberately NOT grant-gated — unlike the `REPOSITION_SCHEDULE_CURSOR` path
 * it replaces. That is safe, and in fact strictly tighter, because of what it
 * cannot touch: `cursorDate`, `lastCompletedAt` and `lastPerformedLocalDate`
 * are carried forward verbatim and Firestore Rules reject any write that
 * changes them on this branch. The old reposition path moved `cursorDate`
 * (which is why it needed a server-issued grant); selection moves only the
 * SUGGESTION, which grants the user nothing they are not already entitled to
 * — picking which of their own program's sessions to see next.
 *
 * Nothing about completion is written here: no execution, no `COMPLETED`
 * event, no frequency, no streak. Selecting is not training.
 *
 * Runs in a transaction so two devices selecting at the same moment serialize
 * instead of both rebasing off the same version; the Rules additionally
 * require `suggestionVersion` to advance by exactly 1, so a lost update fails
 * closed rather than silently skipping a position.
 */
export async function selectWorkoutSession(input: {
  uid: string;
  programId: string;
  programInstanceId?: string;
  sessionCount: number;
  targetSessionIndex: number;
  /** Used only when no `scheduleState` exists yet (first ever selection). */
  activatedAtLocalDate: string;
}): Promise<SessionSuggestion> {
  const ref = scheduleStateRef(input.uid, input.programId, input.programInstanceId);
  return runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(ref);
    const data = snapshot.exists() ? snapshot.data() : null;
    const current = readSessionSuggestion(data, input.sessionCount);
    const transition = selectSession(current, input.targetSessionIndex, input.sessionCount);
    if (transition.status === 'REJECTED') throw new Error(transition.reason);
    // A repeated tap on the same session is already expressed by the stored
    // pointer — no write, so the rotation cannot walk forward twice.
    if (transition.status === 'UNCHANGED') return transition.suggestion;

    const { suggestion } = transition;
    transaction.set(ref, {
      programId: input.programId,
      ...(input.programInstanceId ? { programInstanceId: input.programInstanceId } : {}),
      // Kept in lockstep: `nextSessionIndex` is what legacy readers (the
      // resolver, re-engagement episodes, daily notifications) still consult,
      // and it has always meant exactly "the next session the rotation owes".
      nextSessionIndex: suggestion.suggestedSessionIndex,
      suggestedSessionIndex: suggestion.suggestedSessionIndex,
      suggestionVersion: suggestion.version,
      lastSelectedSessionIndex: suggestion.lastSelectedSessionIndex,
      // Completion-derived facts: preserved exactly, never authored here.
      cursorDate: (data?.cursorDate as string | undefined) ?? input.activatedAtLocalDate,
      lastCompletedAt: (data?.lastCompletedAt as string | null | undefined) ?? null,
      lastPerformedLocalDate: (data?.lastPerformedLocalDate as string | null | undefined) ?? null,
      // Decision 2.b: an explicit choice is the user's answer. No missed-session
      // question may stand between them and training.
      pendingMissDecision: null,
      updatedAt: serverTimestamp(),
    });
    return suggestion;
  });
}

/**
 * Progression ledger for one ProgramInstance. Content-addressed program ids
 * can be reused by later instances, so reading the whole program ledger and
 * discarding other instances locally creates unbounded historical overfetch.
 * Legacy events without `programInstanceId` were already ignored by every
 * V2 progression consumer and remain excluded by the equivalent server-side
 * equality filter.
 */
export async function listScheduleEventsForProgramInstance(
  uid: string,
  programId: string,
  programInstanceId: string,
): Promise<ScheduleEvent[]> {
  countFirestoreRead('workout_schedule.events');
  const snapshot = await getDocs(query(
    scheduleEventsCollection(uid, programId),
    where('programInstanceId', '==', programInstanceId),
  ));
  return snapshot.docs.map((item) => item.data() as ScheduleEvent);
}
