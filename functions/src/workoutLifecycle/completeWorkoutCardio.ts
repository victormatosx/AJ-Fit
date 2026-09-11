import { FieldValue, type DocumentData, type Firestore } from 'firebase-admin/firestore';
import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';

import { db as defaultDb } from '../lib/firebaseAdmin';
import { requireAuth } from '../lib/auth';

/**
 * Server-side authority for Cardio Finisher completion (Cardio Finisher
 * Completion Recovery hardening, Architecture B — 2026-09 security audit).
 *
 * Firestore Rules never let the client write `WorkoutExecution.cardio`
 * directly (see `firestore.rules`'s `workoutExecutions` create/update
 * rules) — this callable performs the ENTIRE write via the Admin SDK inside
 * a transaction, the same trust pattern `applyExerciseSubstitutionHandler`
 * already uses in this file's sibling module. A compromised or
 * hand-crafted client request can never fabricate a completion, an
 * arbitrary duration, or a fabricated `completedAt` — every one of those
 * was proven possible under the PRIOR ("shape only") Rules by
 * `firestore-tests/workoutExecutionCardioSecurityAudit.rules.test.ts`
 * before this hardening.
 *
 * Three things this handler proves server-side that the client payload can
 * never assert on its own:
 * 1. Ownership — `executionId` is only ever looked up under
 *    `users/{context.auth.uid}/workoutExecutions/{executionId}`; a uid is
 *    NEVER read from the request body, only from the verified ID token
 *    (`requireAuth`). Another user's execution is indistinguishable from a
 *    nonexistent one (`not-found`), never a `permission-denied` that would
 *    confirm it exists.
 * 2. State — the execution must be `IN_PROGRESS` (or, idempotently, already
 *    have `cardio.status === 'COMPLETED'`, in which case the original
 *    record is returned unchanged — a double tap or a retry after a
 *    network failure can never overwrite an earlier confirmed duration).
 * 3. Authority over "does this session even have a cardio finisher" —
 *    re-derived from `users/{uid}/workoutPrograms/{execution.programId}`
 *    (`programId` is always present regardless of schema version — V1
 *    content identity, retained on V2 too, see `WorkoutExecution.programId`'s
 *    doc comment, src/workoutExecution/types.ts — so this needs no V1/V2
 *    branch), never trusted from the client payload. A client cannot pick
 *    an arbitrary IN_PROGRESS execution whose session has no cardio
 *    finisher and call this callable to fabricate one.
 */

/**
 * Absolute cap on `actualDurationSeconds` — mirrors `MAX_CARDIO_TARGET_SECONDS`
 * (src/lib/cardioTimer.ts, client app): the SAME ceiling the client's own
 * "+5 min" extension already enforces on the live cardio target (guards
 * against runaway taps, not an invented physiological rule). Duplicated
 * here — `functions/` and the app are separate TypeScript projects with no
 * shared module boundary (same reason `ExerciseSubstitutionScope` is
 * duplicated between `exerciseSubstitution.ts` here and
 * `src/services/exerciseSubstitution.ts`) — kept numerically identical on
 * purpose; if the client constant ever changes, update this one too.
 */
export const MAX_CARDIO_ACTUAL_DURATION_SECONDS = 3 * 60 * 60; // 3h, same as MAX_CARDIO_TARGET_SECONDS

export interface CompleteWorkoutCardioRequest {
  executionId: string;
  actualDurationSeconds: number;
}

export interface CompleteWorkoutCardioResult {
  status: 'COMPLETED';
  actualDurationSeconds: number;
}

function plainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function boundedId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,120}$/.test(value);
}

/**
 * Rejects NaN, Infinity, negative, non-integer, non-number, and anything
 * past the app's own existing ceiling for "how long can a cardio session
 * possibly be" — `0` is valid (the "Pular cardio"/skip-before-starting
 * path finalizes with `actualDurationSeconds: 0`, see
 * `CardioScreen.finalizeNow` in `src/screens/WorkoutScreen.tsx`).
 */
function validActualDurationSeconds(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isFinite(value)
    && Number.isInteger(value)
    && value >= 0
    && value <= MAX_CARDIO_ACTUAL_DURATION_SECONDS;
}

function parseRequest(value: unknown): CompleteWorkoutCardioRequest {
  if (
    !plainObject(value)
    || !boundedId(value.executionId)
    || !validActualDurationSeconds(value.actualDurationSeconds)
  ) {
    throw new HttpsError('invalid-argument', 'invalid_complete_workout_cardio_request');
  }
  return value as unknown as CompleteWorkoutCardioRequest;
}

function completedCardioResult(cardio: DocumentData): CompleteWorkoutCardioResult {
  return { status: 'COMPLETED', actualDurationSeconds: cardio.actualDurationSeconds as number };
}

export async function completeWorkoutCardioHandler(
  request: CallableRequest,
  firestore: Firestore = defaultDb,
): Promise<CompleteWorkoutCardioResult> {
  const uid = requireAuth(request);
  const data = parseRequest(request.data);
  const root = firestore.collection('users').doc(uid);
  const executionRef = root.collection('workoutExecutions').doc(data.executionId);

  const executionSnapshot = await executionRef.get();
  if (!executionSnapshot.exists) throw new HttpsError('not-found', 'execution_not_found');
  const execution = executionSnapshot.data()!;

  // Idempotent short-circuit BEFORE the transaction — a very-delayed retry
  // landing after the session is already fully terminal (finish() already
  // ran) still returns the original record, never an error, and never a
  // rewrite (docs — item 4 of the audit: "não permita transformar uma
  // conclusão anterior de 1200s em 5000s por retry").
  if (plainObject(execution.cardio) && execution.cardio.status === 'COMPLETED') {
    return completedCardioResult(execution.cardio);
  }

  if (execution.status !== 'IN_PROGRESS') {
    throw new HttpsError('failed-precondition', 'execution_not_in_progress');
  }

  // Authority over "does this execution's session actually have a cardio
  // finisher" — never trusted from the client payload (see module doc
  // comment, point 3). Read outside the transaction: the referenced
  // program snapshot is immutable content, never mutated after creation
  // (same precedent `applyExerciseSubstitutionHandler` already relies on
  // for its own catalog/program context reads).
  const programSnapshot = await root.collection('workoutPrograms').doc(String(execution.programId)).get();
  if (!programSnapshot.exists) throw new HttpsError('failed-precondition', 'program_context_missing');
  const program = programSnapshot.data()!;
  const sessions = Array.isArray(program.sessions) ? program.sessions : [];
  const session = sessions[execution.sessionIndex as number] as DocumentData | undefined;
  if (!session || !plainObject(session.cardioFinisher)) {
    throw new HttpsError('failed-precondition', 'session_has_no_cardio_finisher');
  }

  return firestore.runTransaction(async (transaction) => {
    const fresh = await transaction.get(executionRef);
    if (!fresh.exists) throw new HttpsError('not-found', 'execution_not_found');
    const freshData = fresh.data()!;

    // Re-checked against the transaction's own authoritative read — a
    // concurrent call (double tap, or a retry racing the first attempt's
    // still-in-flight commit) can never both win.
    if (plainObject(freshData.cardio) && freshData.cardio.status === 'COMPLETED') {
      return completedCardioResult(freshData.cardio);
    }
    if (freshData.status !== 'IN_PROGRESS') {
      throw new HttpsError('failed-precondition', 'execution_not_in_progress');
    }

    transaction.update(executionRef, {
      cardio: {
        status: 'COMPLETED',
        actualDurationSeconds: data.actualDurationSeconds,
        completedAt: FieldValue.serverTimestamp(),
      },
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { status: 'COMPLETED' as const, actualDurationSeconds: data.actualDurationSeconds };
  });
}
