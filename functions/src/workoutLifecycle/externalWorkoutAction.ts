import type { Request } from 'firebase-functions/v2/https';
import type { Response } from 'express';
import { FieldValue, type DocumentData, type Firestore } from 'firebase-admin/firestore';

import { db as defaultDb } from '../lib/firebaseAdmin';
import { logInfo, logWarn } from '../lib/logger';
import {
  verifyWorkoutActionCapability,
  WORKOUT_ACTION_CAPABILITY_SECRET,
} from './workoutActionCapability';
import {
  decideSetCompletion,
  isValidActualReps,
  isValidWeightKg,
  type MinimalExerciseExecution,
} from './completeSetTransition';

/**
 * Fase 3 — the ONLY action this endpoint implements is `complete_set`.
 * Draft adjustments (+/-) stay entirely local to the widget extension
 * (`AdjustStepperIntent.swift`) — never routed through a server round trip.
 * No `CompleteSetIntent`/button calls this yet (Fase 4); this phase proves
 * the infrastructure via automated/controlled calls only.
 *
 * Trust model: the caller (eventually the widget extension) has no Firebase
 * Auth session and no App Check attestation — it authenticates purely via
 * the short-lived, server-signed capability token
 * (`workoutActionCapability.ts`). The identity used for every Firestore
 * read/write below is ALWAYS `claims.uid` from the verified token, NEVER
 * anything the request body claims. `executionId` in the body must match
 * the token's own `executionId` exactly — a stolen/replayed token for
 * execution A can never be pointed at execution B by editing the request.
 *
 * Idempotency without a Firestore document: `decideSetCompletion`
 * (`completeSetTransition.ts`) makes the target set's own
 * `(exerciseIndex, setIndex, status)` the complete idempotency key. A
 * retry, a double tap, or two near-simultaneous requests all resolve to
 * exactly one write — the Firestore transaction's own optimistic-concurrency
 * retry guarantees the SECOND reader observes the FIRST writer's commit
 * before deciding anything (see the transaction body below).
 */

const MAX_BODY_BYTES = 4_096;

export type CompleteSetActionStatus = 'completed_now' | 'already_completed';

export interface CompleteSetActionResult {
  status: CompleteSetActionStatus;
  executionId: string;
  exerciseIndex: number;
  setIndex: number;
  weightKg: number | null;
  actualReps: number | null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function boundedId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,120}$/.test(value);
}

function validIndex(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < 64;
}

function nullableNumber(value: unknown): value is number | null {
  return value === null || typeof value === 'number';
}

interface ParsedCompleteSetRequest {
  action: 'complete_set';
  token: string;
  executionId: string;
  exerciseIndex: number;
  setIndex: number;
  weightKg: number | null;
  actualReps: number | null;
}

type RequestParseFailure = Readonly<{ ok: false; status: number; error: string }>;
type RequestParseSuccess = Readonly<{ ok: true; value: ParsedCompleteSetRequest }>;

/**
 * Every field checked by shape/type/range BEFORE any Firestore access — a
 * malformed or manipulated payload never reaches the transaction. `weightKg`
 * is required for `complete_set` (there is always a load to log, even 0 for
 * bodyweight); `actualReps` stays optional, matching `recordSetExecution`'s
 * own existing contract.
 */
function parseCompleteSetRequest(body: unknown): RequestParseFailure | RequestParseSuccess {
  if (!isPlainObject(body)) {
    return { ok: false, status: 400, error: 'invalid_body' };
  }
  if (body.action !== 'complete_set') {
    return { ok: false, status: 400, error: 'unsupported_action' };
  }
  if (typeof body.token !== 'string' || body.token.length === 0) {
    return { ok: false, status: 400, error: 'missing_token' };
  }
  if (!boundedId(body.executionId)) {
    return { ok: false, status: 400, error: 'invalid_execution_id' };
  }
  if (!validIndex(body.exerciseIndex)) {
    return { ok: false, status: 400, error: 'invalid_exercise_index' };
  }
  if (!validIndex(body.setIndex)) {
    return { ok: false, status: 400, error: 'invalid_set_index' };
  }
  if (!nullableNumber(body.weightKg) || !isValidWeightKg(body.weightKg)) {
    return { ok: false, status: 400, error: 'invalid_weight_kg' };
  }
  const actualReps = body.actualReps === undefined ? null : body.actualReps;
  if (!nullableNumber(actualReps) || !isValidActualReps(actualReps)) {
    return { ok: false, status: 400, error: 'invalid_actual_reps' };
  }
  const allowed = new Set(['action', 'token', 'executionId', 'exerciseIndex', 'setIndex', 'weightKg', 'actualReps']);
  if (Object.keys(body).some((key) => !allowed.has(key))) {
    return { ok: false, status: 400, error: 'unexpected_field' };
  }
  return {
    ok: true,
    value: {
      action: 'complete_set',
      token: body.token,
      executionId: body.executionId,
      exerciseIndex: body.exerciseIndex,
      setIndex: body.setIndex,
      weightKg: body.weightKg,
      actualReps,
    },
  };
}

function toMinimalExercises(execution: DocumentData): MinimalExerciseExecution[] {
  const exercises = Array.isArray(execution.exercises) ? execution.exercises : [];
  return exercises.map((exercise) => ({
    sets: Array.isArray(exercise?.sets)
      ? exercise.sets.map((set: DocumentData) => ({
          status: set?.status,
          weightKg: set?.weightKg ?? null,
          actualReps: set?.actualReps ?? null,
        }))
      : [],
  }));
}

function sendJson(res: Response, status: number, body: unknown): void {
  res.status(status).json(body);
}

export async function externalWorkoutActionHandler(
  req: Request,
  res: Response,
  deps: { firestore?: Firestore; secret?: string } = {},
): Promise<void> {
  const firestore = deps.firestore ?? defaultDb;

  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'method_not_allowed' });
    return;
  }

  // Defense in depth against an oversized body before it is ever parsed —
  // this endpoint's entire legitimate payload is a handful of short fields.
  const contentLength = Number(req.headers['content-length'] ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    sendJson(res, 400, { error: 'payload_too_large' });
    return;
  }

  const parsed = parseCompleteSetRequest(req.body);
  if (!parsed.ok) {
    sendJson(res, parsed.status, { error: parsed.error });
    return;
  }
  const request = parsed.value;

  const secret = deps.secret ?? WORKOUT_ACTION_CAPABILITY_SECRET.value();
  const verification = verifyWorkoutActionCapability(request.token, secret);
  if (!verification.valid) {
    logWarn('externalWorkoutAction', 'capability_rejected', { reason: verification.reason });
    sendJson(res, 401, { error: 'invalid_capability' });
    return;
  }
  const claims = verification.claims;

  // A capability minted for execution A can never be pointed at execution
  // B by editing the request body — the token's own executionId is the
  // only one trusted; this is only a defense-in-depth equality check.
  if (claims.executionId !== request.executionId) {
    logWarn('externalWorkoutAction', 'execution_id_mismatch');
    sendJson(res, 403, { error: 'execution_id_mismatch' });
    return;
  }

  // uid ALWAYS comes from the verified capability — never request.body.
  const executionRef = firestore
    .collection('users').doc(claims.uid)
    .collection('workoutExecutions').doc(claims.executionId);

  const snapshot = await executionRef.get();
  if (!snapshot.exists) {
    sendJson(res, 404, { error: 'execution_not_found' });
    return;
  }
  // Idempotent short-circuit before the transaction — mirrors
  // completeWorkoutCardioHandler's own pattern.
  const preliminary = snapshot.data()!;
  if (preliminary.status !== 'IN_PROGRESS') {
    const preliminaryDecision = decideSetCompletion({
      exercises: toMinimalExercises(preliminary),
      exerciseIndex: request.exerciseIndex,
      setIndex: request.setIndex,
      weightKg: request.weightKg,
      actualReps: request.actualReps,
    });
    if (preliminaryDecision.outcome === 'already_completed') {
      sendJson(res, 200, {
        status: 'already_completed',
        executionId: claims.executionId,
        exerciseIndex: request.exerciseIndex,
        setIndex: request.setIndex,
        weightKg: preliminaryDecision.weightKg,
        actualReps: preliminaryDecision.actualReps,
      } satisfies CompleteSetActionResult);
      return;
    }
    sendJson(res, 409, { error: 'execution_not_in_progress' });
    return;
  }

  try {
    const result = await firestore.runTransaction(async (transaction) => {
      const fresh = await transaction.get(executionRef);
      if (!fresh.exists) {
        return { kind: 'error' as const, status: 404, error: 'execution_not_found' };
      }
      const freshData = fresh.data()!;
      if (freshData.status !== 'IN_PROGRESS') {
        // Re-checked against the transaction's own authoritative read — the
        // execution may have finished/been abandoned between the
        // preliminary read above and this transaction's own snapshot.
        const decision = decideSetCompletion({
          exercises: toMinimalExercises(freshData),
          exerciseIndex: request.exerciseIndex,
          setIndex: request.setIndex,
          weightKg: request.weightKg,
          actualReps: request.actualReps,
        });
        if (decision.outcome === 'already_completed') {
          return { kind: 'ok' as const, outcome: decision.outcome, weightKg: decision.weightKg, actualReps: decision.actualReps };
        }
        return { kind: 'error' as const, status: 409, error: 'execution_not_in_progress' };
      }

      const exercises = Array.isArray(freshData.exercises) ? freshData.exercises : [];
      const decision = decideSetCompletion({
        exercises: toMinimalExercises(freshData),
        exerciseIndex: request.exerciseIndex,
        setIndex: request.setIndex,
        weightKg: request.weightKg,
        actualReps: request.actualReps,
      });

      if (decision.outcome === 'rejected') {
        const status = decision.reason === 'SET_NOT_PENDING' ? 409 : 400;
        return { kind: 'error' as const, status, error: decision.reason.toLowerCase() };
      }
      if (decision.outcome === 'already_completed') {
        // A concurrent writer (the app itself, or another in-flight
        // request for the same set) already committed first — this
        // transaction makes NO write. Firestore's own optimistic-
        // concurrency retry is what guarantees this branch is reached
        // instead of a lost update: if two transactions both read PENDING
        // at the same time, only one commits; Firestore automatically
        // retries the other, which then re-reads COMPLETED here.
        return { kind: 'ok' as const, outcome: decision.outcome, weightKg: decision.weightKg, actualReps: decision.actualReps };
      }

      // decision.outcome === 'completed_now'
      const nextExercises = exercises.map((exercise: DocumentData, index: number) => {
        if (index !== request.exerciseIndex) return exercise;
        return {
          ...exercise,
          sets: (exercise.sets as DocumentData[]).map((set, setIdx) => {
            if (setIdx !== request.setIndex) return set;
            return {
              ...set,
              status: 'COMPLETED',
              weightKg: decision.weightKg,
              actualReps: decision.actualReps,
              actualDurationSeconds: null,
            };
          }),
        };
      });
      transaction.update(executionRef, { exercises: nextExercises, updatedAt: FieldValue.serverTimestamp() });
      return { kind: 'ok' as const, outcome: decision.outcome, weightKg: decision.weightKg, actualReps: decision.actualReps };
    });

    if (result.kind === 'error') {
      sendJson(res, result.status, { error: result.error });
      return;
    }

    logInfo('externalWorkoutAction', 'complete_set_resolved', { outcome: result.outcome });
    sendJson(res, 200, {
      status: result.outcome,
      executionId: claims.executionId,
      exerciseIndex: request.exerciseIndex,
      setIndex: request.setIndex,
      weightKg: result.weightKg,
      actualReps: result.actualReps,
    } satisfies CompleteSetActionResult);
  } catch {
    logWarn('externalWorkoutAction', 'transaction_failed');
    sendJson(res, 500, { error: 'internal_error' });
  }
}
