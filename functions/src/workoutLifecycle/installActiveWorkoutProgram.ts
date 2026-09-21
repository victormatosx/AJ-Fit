import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';

import { db as defaultDb } from '../lib/firebaseAdmin';
import { requireAuth } from '../lib/auth';
import { requireActiveAccount } from '../accountDeletion/activeAccountGuard';
import { isOperationBlockedByCircuitBreaker, loadWorkoutLifecycleCircuitBreakerConfig } from './circuitBreaker';
import { validateRequest, type AuthorityRequest } from './authorizeMutation';
import { logInfo, logWarn } from '../lib/logger';

/**
 * Fase 2.8 — server-side install of a brand-new account's FIRST active
 * workout program (`INITIALIZE`). This is the client operation whose
 * `runTransaction` (`saveAndActivateWorkoutProgram`,
 * src/services/workoutPrograms.ts) touches 9 documents across 6 collections
 * — `users`, `workoutProgramState`, `workoutPrograms`, `questionnaires`,
 * `workoutLifecycleState`, `trainingCycles`, `programInstances` — and, once
 * combined with each document's real Firestore Security Rules validation
 * (ownership, schema, lifecycle-authority-grant consumption), reliably
 * exceeds the Firestore rules engine's "maximum of 1000 expressions"
 * evaluation ceiling for this exact, real, common (every new user) flow
 * (Fase 2.6/2.7 audits — confirmed reproducing identically on `main`,
 * confirmed NOT resolved by two rounds of semantically-equivalent rules
 * simplification).
 *
 * Scope is deliberately narrow: ONLY the `INITIALIZE` case (a genuinely
 * brand-new account — no `workoutLifecycleState/current`, no legacy
 * `workoutProgramState/active` pointer). `MIGRATE`/`ACTIVATE`/`ADAPT`/
 * `RECOVER` continue to use the existing client
 * `runTransaction`-inside-`saveAndActivateWorkoutProgram` path, authorized
 * by the existing `authorizeWorkoutLifecycleMutation` grant — those
 * operations carry substantially more branches (superseding prior content,
 * clearing a pending evolution, starting a new TrainingCycle) that a
 * from-scratch Admin SDK port would risk getting subtly wrong; migrating
 * them is out of scope for this pass (see Fase 2.8 report).
 *
 * Reuses `validateRequest`'s `INITIALIZE` branch verbatim (exported from
 * `authorizeMutation.ts` for exactly this purpose) — the SAME authoritative
 * questionnaire load, the SAME canonical prescription generation
 * (`generateCanonicalPlan`), the SAME `assertPlanSafe` safety check, and the
 * SAME deterministic identity derivation already used by the existing
 * grant-issuing flow. This function's only NEW logic is performing the
 * actual document writes via the Admin SDK (which does not evaluate
 * Firestore Security Rules at all) instead of writing a one-time grant for
 * the client to redeem via its own rules-checked transaction.
 *
 * Admin SDK bypasses Firestore Security Rules entirely — every guarantee
 * those rules previously provided for this exact write set must therefore
 * hold BEFORE or INSIDE this function:
 *   - ownership:            `request.auth.uid` only (never a client-supplied
 *                            uid) — enforced by `requireAuth`.
 *   - account-deletion lock: `requireActiveAccount` (the exact server-side
 *                            equivalent of the rules' `accountActive(uid)`).
 *   - questionnaire authority: `validateRequest` loads it itself from
 *                            Firestore; the client's own answers are never
 *                            trusted as content authority.
 *   - schema/content validity: `generateCanonicalPlan`/`assertPlanSafe`
 *                            (inside `validateRequest`) — the plan is
 *                            SERVER-GENERATED, never accepted from the
 *                            client, so the rules' extensive
 *                            `workoutProgramCommonValid` field-shape
 *                            re-validation of a client-supplied document is
 *                            not re-derived here: there is no untrusted
 *                            input to validate against, because the server
 *                            builds every field of every document itself.
 *   - idempotency:          a fresh, in-transaction re-check of
 *                            `workoutLifecycleState/current` — two
 *                            concurrent calls for the same uid converge on
 *                            exactly one written state; the loser observes
 *                            `already_active` instead of writing a second
 *                            program.
 */

export interface InstallActiveWorkoutProgramRequest {
  questionnaireId: string;
  questionnaireVersion: number;
  targetPrescriptionInputSnapshot: Record<string, unknown>;
  source: 'onboarding' | 'automatic_reconciliation';
}

export interface InstallActiveWorkoutProgramResult {
  status: 'installed' | 'already_active';
  programId: string;
  programInstanceId: string;
}

function plainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function boundedId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,160}$/.test(value);
}

function parseRequest(value: unknown): InstallActiveWorkoutProgramRequest {
  if (
    !plainObject(value)
    || !boundedId(value.questionnaireId)
    || !Number.isInteger(value.questionnaireVersion) || (value.questionnaireVersion as number) < 1
    || !plainObject(value.targetPrescriptionInputSnapshot)
    || (value.source !== 'onboarding' && value.source !== 'automatic_reconciliation')
  ) {
    throw new HttpsError('invalid-argument', 'invalid_install_active_workout_program_request');
  }
  return value as unknown as InstallActiveWorkoutProgramRequest;
}

export async function installActiveWorkoutProgramHandler(
  request: CallableRequest,
  firestore: Firestore = defaultDb,
): Promise<InstallActiveWorkoutProgramResult> {
  const uid = requireAuth(request);
  await requireActiveAccount(uid, firestore);
  const data = parseRequest(request.data);

  const root = firestore.collection('users').doc(uid);
  const lifecycleRef = root.collection('workoutLifecycleState').doc('current');

  // Cheap pre-check (outside the transaction): the overwhelmingly common
  // case is a genuinely fresh account, so this only exists to fail fast and
  // gracefully for the rarer "already installed" caller (e.g. a retried
  // client request after a lost response) without paying for canonical plan
  // generation first. The transaction below re-checks this fresh regardless
  // — this is an optimization, not the correctness boundary.
  const precheck = await lifecycleRef.get();
  if (precheck.exists) {
    const existing = precheck.data()!;
    logInfo('workoutLifecycle.install', 'already_active_precheck', { uid: uid.slice(0, 6) });
    return {
      status: 'already_active',
      programId: existing.activeContentIdentity as string,
      programInstanceId: existing.activeProgramInstanceId as string,
    };
  }

  const circuitBreakerConfig = await loadWorkoutLifecycleCircuitBreakerConfig(firestore);
  if (isOperationBlockedByCircuitBreaker('INITIALIZE', circuitBreakerConfig)) {
    throw new HttpsError('unavailable', 'workout_lifecycle_circuit_breaker_open');
  }

  const authorityRequest: AuthorityRequest = {
    operation: 'INITIALIZE',
    questionnaireId: data.questionnaireId,
    questionnaireVersion: data.questionnaireVersion,
    targetPrescriptionInputSnapshot: data.targetPrescriptionInputSnapshot,
    // `validateRequest`'s INITIALIZE/MIGRATE branch requires these two
    // fields to be present and bounded-id-shaped (authorizeMutation.ts's
    // `missing_authority_targets` check), but — confirmed by reading that
    // function's full INITIALIZE branch — never reads their VALUE: the
    // real `targetProgramInstanceId`/`targetCycleId` returned to us below
    // are independently derived from `canonicalOperationKey` (itself
    // derived from the server-generated `targetContentIdentity`), only
    // after the canonical plan is generated. This existing shape-check
    // only makes sense for the grant-issuing caller, where the client
    // supplies its own local candidate ids; this Function has none to
    // offer, so these are inert placeholders satisfying the shape check.
    targetProgramInstanceId: 'wpi_pending_server_install',
    targetCycleId: 'cyc_pending_server_install',
  };

  let validated: Record<string, unknown>;
  try {
    validated = await validateRequest(uid, authorityRequest, firestore);
  } catch (error) {
    if (error instanceof HttpsError && error.code === 'aborted' && error.message === 'lifecycle_already_initialized') {
      // Lost the race between the pre-check above and here — converge
      // gracefully instead of surfacing an error for a benign concurrent
      // retry (Fase 2.8.6/2.8.7).
      const fresh = await lifecycleRef.get();
      if (fresh.exists) {
        const existing = fresh.data()!;
        logInfo('workoutLifecycle.install', 'already_active_race', { uid: uid.slice(0, 6) });
        return {
          status: 'already_active',
          programId: existing.activeContentIdentity as string,
          programInstanceId: existing.activeProgramInstanceId as string,
        };
      }
    }
    throw error;
  }

  const targetPlan = validated.targetPlan as Record<string, unknown>;
  const programId = validated.targetContentIdentity as string;
  const programInstanceId = validated.targetProgramInstanceId as string;
  const cycleId = validated.targetCycleId as string;
  const startingLevel = validated.targetTrainingLevel as string;
  const eventId = validated.eventId as string;
  const operationKey = validated.idempotencyKey as string;

  const programRef = root.collection('workoutPrograms').doc(programId);
  const cycleRef = root.collection('trainingCycles').doc(cycleId);
  const instanceRef = root.collection('programInstances').doc(programInstanceId);
  const stateRef = root.collection('workoutProgramState').doc('active');
  const eventRef = root.collection('workoutLifecycleEvents').doc(eventId);

  await firestore.runTransaction(async (transaction) => {
    // Fresh, in-transaction re-check — this (not the pre-check above) is the
    // actual convergence boundary for two truly concurrent calls.
    const freshLifecycle = await transaction.get(lifecycleRef);
    if (freshLifecycle.exists) {
      throw new HttpsError('aborted', 'lifecycle_already_initialized');
    }
    const now = Timestamp.now();
    transaction.set(programRef, {
      ...targetPlan,
      programId,
      prescriptionId: targetPlan.planId,
      status: 'active',
      source: data.source,
      templateVersion: validated.targetTemplateVersion,
      templateSourceVersion: validated.targetTemplateSourceVersion,
      templateContentHash: validated.targetTemplateContentHash,
      questionnaireId: data.questionnaireId,
      questionnaireVersion: data.questionnaireVersion,
      createdAt: now,
      activatedAt: now,
      updatedAt: now,
    });
    transaction.set(cycleRef, {
      cycleId,
      level: startingLevel,
      cycleNumber: 1,
      status: 'ACTIVE',
      origin: 'V2_NATIVE',
      programInstanceId,
      previousProgramInstanceId: null,
      startedAt: now,
      eligibleAt: null,
      completedAt: null,
      completionReason: null,
      progressionReason: 'INITIAL_PRESCRIPTION',
      schemaVersion: 2,
      createdAt: now,
      updatedAt: now,
    });
    transaction.set(instanceRef, {
      programInstanceId,
      cycleId,
      contentIdentity: programId,
      prescriptionIdentity: targetPlan.planId,
      questionnaireId: data.questionnaireId,
      prescriptionInputSnapshot: data.targetPrescriptionInputSnapshot,
      activatedAt: now,
      supersededAt: null,
      previousProgramInstanceId: null,
      activationReason: 'INITIAL_PROGRAM',
      schemaVersion: 2,
      createdAt: now,
      updatedAt: now,
    });
    transaction.set(lifecycleRef, {
      startingLevel,
      currentTrainingLevel: startingLevel,
      currentCycleId: cycleId,
      currentCycleNumber: 1,
      activeProgramInstanceId: programInstanceId,
      activeContentIdentity: programId,
      activePrescriptionIdentity: targetPlan.planId,
      initializationOrigin: 'V2_NATIVE',
      historyCompleteFrom: now,
      schemaVersion: 2,
      createdAt: now,
      updatedAt: now,
    });
    transaction.set(eventRef, {
      eventId,
      type: 'PROGRAM_STARTED',
      occurredAt: now,
      cycleId,
      programInstanceId,
      idempotencyKey: operationKey,
      payload: { source: data.source },
      schemaVersion: 2,
    });
    transaction.set(stateRef, {
      programId,
      programInstanceId,
      updatedAt: now,
    });
  }).catch(async (error) => {
    if (error instanceof HttpsError && error.code === 'aborted' && error.message === 'lifecycle_already_initialized') {
      logInfo('workoutLifecycle.install', 'already_active_transaction_race', { uid: uid.slice(0, 6) });
      return;
    }
    logWarn('workoutLifecycle.install', 'transaction_failed', { uid: uid.slice(0, 6), error: String(error) });
    throw error;
  });

  const finalLifecycle = await lifecycleRef.get();
  const finalData = finalLifecycle.data();
  if (!finalLifecycle.exists || !finalData) {
    throw new HttpsError('internal', 'workout_lifecycle_install_did_not_converge');
  }
  logInfo('workoutLifecycle.install', 'committed', { uid: uid.slice(0, 6) });
  return {
    status: finalData.activeContentIdentity === programId ? 'installed' : 'already_active',
    programId: finalData.activeContentIdentity as string,
    programInstanceId: finalData.activeProgramInstanceId as string,
  };
}
