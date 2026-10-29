import { doc, runTransaction, serverTimestamp, Timestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { logWarn } from '../lib/logger';
import { recordPerfMark, recordPerfTrace, startPerfTimer } from '../lib/perf';
import {
  lifecycleEventId,
  pendingEvolutionIdForOperation,
  programInstanceIdForOperation,
} from '../workoutLifecycle/domain';
import { applyDefer, canDefer, isAutoActivationDue, resolveDeferralConfig, toDeferralView } from '../workoutLifecycle/deferral';
import { resolveWorkoutLifecycleProgressionPolicy } from '../workoutLifecycle/qaPolicy';
import {
  WORKOUT_LIFECYCLE_SCHEMA_VERSION,
  type CurrentTrainingLevel,
  type PendingEvolution,
  type PendingEvolutionType,
} from '../workoutLifecycle/types';
import type { QuestionnaireAnswers, TemplateId } from '../workoutPrescription/types';
import type { LevelPromotionTarget } from '../prescriptionEvolution/levelPromotion';
import { MIN_WEEKLY_DAYS, maxWeeklyDaysForTrainingLevel } from '../onboarding/weeklyDayAllowance';
import { buildPrescriptionInputSnapshot, questionnaireAnswersFromPrescriptionInputs } from '../workoutLifecycle/prescriptionInputs';
import { evolvePrescription } from './prescriptionEvolution';
import { loadAuthoritativePrescriptionInputs } from './prescriptionInputs';
import { evaluateProgressionV2ForUser } from './workoutProgressionV2';
import type { ProgressionDecision } from '../progressionEngineV2/types';
import {
  lifecycleRef,
  loadPendingEvolution,
  loadWorkoutLifecycle,
  listTrainingCycles,
  listWorkoutLifecycleEventsForProgramInstance,
  pendingEvolutionRef,
  recoverWorkoutLifecyclePartialState,
} from './workoutLifecycle';
import { countEarnedIntermediateCycles } from '../progressionEngineV2/earnedCycles';
import { PROGRESSION_V2_CONFIG } from '../progressionEngineV2/config';
import {
  contentIdentityFor,
  loadActiveWorkoutProgram,
  loadWorkoutTemplate,
  prepareWorkoutProgram,
  saveAndActivateWorkoutProgram,
  withoutUndefined,
  type WorkoutProgramSnapshot,
} from './workoutPrograms';
import { fromWorkoutTemplateDocument } from '../workoutPrescription/templateDocument';
import { resolvePendingEvolutionTemplate } from './pendingEvolutionTemplate';
import {
  logWorkoutLifecycleEvent,
  workoutLifecycleErrorCategory,
} from '../workoutLifecycle/telemetry';
import {
  authorizeWorkoutLifecycleMutation,
  requireWorkoutLifecycleCanonical,
  WORKOUT_LIFECYCLE_AUTHORITY_GRANT_ID,
  type WorkoutLifecycleAuthorityRequest,
} from '../workoutLifecycle/authorityProvider';

const USERS = 'users';
const WORKOUT_LIFECYCLE_EVENTS = 'workoutLifecycleEvents';

function eventRef(uid: string, eventId: string) {
  return doc(db, USERS, uid, WORKOUT_LIFECYCLE_EVENTS, eventId);
}

function authorityGrantRef(uid: string) {
  return doc(db, USERS, uid, 'workoutLifecycleAuthorityGrants', WORKOUT_LIFECYCLE_AUTHORITY_GRANT_ID);
}

// ─── PREPARE ────────────────────────────────────────────────────────────

export type PrepareEvolutionResult =
  | { status: 'NO_ACTION'; decision?: ProgressionDecision | null }
  | { status: 'ALREADY_PENDING'; pending: PendingEvolution<Timestamp> }
  | { status: 'NO_LIFECYCLE' }
  | { status: 'PREPARATION_FAILED'; reasonCodes: string[] }
  | { status: 'PREPARED'; pending: PendingEvolution<Timestamp> };

interface EarnedEvolutionFact {
  idempotencyKey: string;
  type: PendingEvolutionType;
  fromLevel: CurrentTrainingLevel;
  toLevel: CurrentTrainingLevel;
  quality: PendingEvolution<Timestamp>['quality'];
  sessionsCompletedAtEarn: number;
  adherenceAtEarnBp: number;
  earnedAt: Timestamp;
  deferralCount: 0 | 1 | 2;
  nextPromptAt: Timestamp | null;
  autoActivateAt: Timestamp | null;
  /**
   * QA_TRANSITION marker (docs/workout-lifecycle/v2/qa/) — set ONLY by
   * `prepareQaTransitionEvolution` below. Included in the `earnedFact` sent
   * to the backend's EARN authorization (so it can match its own
   * QA-forced computation) and in the ephemeral authority grant document,
   * but deliberately NEVER in the persisted `workoutLifecycleEvents`
   * ledger payload — `persistEarnedFact` picks an explicit 6-field object
   * for that write, so a QA-forced transition never needs a Rules change
   * to stay out of the domain ledger's strict payload schema. Telemetry
   * tags QA_TRANSITION independently via the account's own QA mode
   * (`functions/src/telemetry/trustedWorkoutLifecycleTelemetry.ts`), not
   * via this field.
   */
  qaForced?: true;
  triggerSource?: 'QA_TRANSITION';
}

function timestampMillis(value: Timestamp): number {
  return value.toMillis();
}

async function measurePrepareStep<T>(label: string, operation: () => Promise<T>): Promise<T> {
  const stop = startPerfTimer(label);
  try {
    return await operation();
  } finally {
    stop();
  }
}

async function loadOutstandingEarnedFact(uid: string): Promise<EarnedEvolutionFact | null> {
  const lifecycle = await measurePrepareStep(
    'evolution_prepare.outstanding.lifecycle',
    () => loadWorkoutLifecycle(uid),
  );
  if (!lifecycle) return null;
  const events = await measurePrepareStep(
    'evolution_prepare.outstanding.events',
    () => listWorkoutLifecycleEventsForProgramInstance(
      uid,
      lifecycle.lifecycle.activeProgramInstanceId,
    ),
  );
  const stopLocal = startPerfTimer('evolution_prepare.outstanding.local');
  try {
  const activationEvents = events
    .filter((event) => ['LEVEL_PROMOTED', 'EVOLUTION_ACTIVATED', 'MOTIVATIONAL_RENEWAL_ACTIVATED'].includes(event.type));
  const activations = new Set(activationEvents
    .map((event) => event.idempotencyKey));
  const earnedCandidates = events
    .filter((event) => event.type === 'EVOLUTION_EARNED' || event.type === 'MOTIVATIONAL_RENEWAL_OFFERED')
    .sort((a, b) => timestampMillis(b.occurredAt) - timestampMillis(a.occurredAt));
  const outstandingCandidates = earnedCandidates
    .filter((event) => !activations.has(`activation:${event.idempotencyKey}`));
  const earned = outstandingCandidates[0];
  if (!earned) {
    const docsUsed = earnedCandidates.length + activationEvents.length;
    recordPerfTrace('evolution_prepare.outstanding_events.cardinality', {
      logicalPath: 'users/{uid}/workoutLifecycleEvents',
      operationType: 'query/getDocs',
      filters: 'programInstanceId == activeProgramInstanceId',
      orderBy: 'none',
      limit: 'none',
      temporalWindow: 'entire active ProgramInstance lifecycle ledger',
      readCounterLabel: 'workout_lifecycle.program_instance_events',
      docsReturned: events.length,
      docsConsidered: docsUsed,
      docsUsed,
      docsDiscardedLocally: events.length - docsUsed,
      earnedCandidates: earnedCandidates.length,
      acknowledgedEarnedCandidates: earnedCandidates.length - outstandingCandidates.length,
      olderOutstandingEarnedCandidates: 0,
      matchingDeferrals: 0,
    });
    return null;
  }

  const type = String(earned.payload.evolutionType) as PendingEvolutionType;
  if (!['CYCLE_EVOLUTION', 'LEVEL_PROMOTION', 'MOTIVATIONAL_RENEWAL'].includes(type)) {
    recordPerfTrace('evolution_prepare.outstanding_events.cardinality', {
      logicalPath: 'users/{uid}/workoutLifecycleEvents',
      operationType: 'query/getDocs', filters: 'programInstanceId == activeProgramInstanceId',
      orderBy: 'none', limit: 'none', temporalWindow: 'entire active ProgramInstance lifecycle ledger',
      readCounterLabel: 'workout_lifecycle.program_instance_events', docsReturned: events.length,
      docsConsidered: earnedCandidates.length + activationEvents.length,
      docsUsed: earnedCandidates.length + activationEvents.length,
      docsDiscardedLocally: events.length - earnedCandidates.length - activationEvents.length,
      earnedCandidates: earnedCandidates.length,
      acknowledgedEarnedCandidates: earnedCandidates.length - outstandingCandidates.length,
      olderOutstandingEarnedCandidates: Math.max(0, outstandingCandidates.length - 1),
      matchingDeferrals: 0,
    });
    return null;
  }
  const deferEvents = events
    .filter((event) => event.type === 'EVOLUTION_DEFERRED' && event.idempotencyKey.startsWith(`${earned.idempotencyKey}:defer:`))
    .sort((a, b) => timestampMillis(a.occurredAt) - timestampMillis(b.occurredAt));
  const docsUsed = earnedCandidates.length + activationEvents.length + deferEvents.length;
  recordPerfTrace('evolution_prepare.outstanding_events.cardinality', {
    logicalPath: 'users/{uid}/workoutLifecycleEvents',
    operationType: 'query/getDocs',
    filters: 'programInstanceId == activeProgramInstanceId',
    orderBy: 'none',
    limit: 'none',
    temporalWindow: 'entire active ProgramInstance lifecycle ledger',
    readCounterLabel: 'workout_lifecycle.program_instance_events',
    docsReturned: events.length,
    docsConsidered: docsUsed,
    docsUsed,
    docsDiscardedLocally: events.length - docsUsed,
    earnedCandidates: earnedCandidates.length,
    acknowledgedEarnedCandidates: earnedCandidates.length - outstandingCandidates.length,
    olderOutstandingEarnedCandidates: Math.max(0, outstandingCandidates.length - 1),
    matchingDeferrals: deferEvents.length,
  });
  const deferralCount = Math.min(2, deferEvents.length) as 0 | 1 | 2;
  const lastDeferEvent = deferEvents.at(-1) ?? null;
  const lastDefer = lastDeferEvent?.occurredAt ?? null;
  const windowMs = 14 * 24 * 60 * 60 * 1000;
  const persistedNextPromptAtMs = lastDeferEvent?.payload.nextPromptAtMs;
  const persistedAutoActivateAtMs = lastDeferEvent?.payload.autoActivateAtMs;
  const nextPromptAt = deferralCount === 1 && typeof persistedNextPromptAtMs === 'number'
    ? Timestamp.fromMillis(persistedNextPromptAtMs)
    : deferralCount === 1 && lastDefer
      ? Timestamp.fromMillis(lastDefer.toMillis() + windowMs)
    : null;
  const autoActivateAt = deferralCount === 2 && typeof persistedAutoActivateAtMs === 'number'
    ? Timestamp.fromMillis(persistedAutoActivateAtMs)
    : deferralCount === 2 && lastDefer
      ? Timestamp.fromMillis(lastDefer.toMillis() + windowMs)
    : null;
  const fromLevel = String(earned.payload.fromLevel ?? lifecycle.cycle.level) as CurrentTrainingLevel;
  const toLevel = String(earned.payload.toLevel ?? (
    type === 'LEVEL_PROMOTION' ? lifecycle.lifecycle.currentTrainingLevel : lifecycle.cycle.level
  )) as CurrentTrainingLevel;
  return {
    idempotencyKey: earned.idempotencyKey,
    type,
    fromLevel,
    toLevel,
    quality: String(earned.payload.quality ?? 'GOOD') as EarnedEvolutionFact['quality'],
    sessionsCompletedAtEarn: Number(earned.payload.sessionsCompletedAtEarn ?? 0),
    adherenceAtEarnBp: Number(earned.payload.adherenceAtEarnBp ?? 0),
    earnedAt: earned.occurredAt,
    deferralCount,
    nextPromptAt,
    autoActivateAt,
  };
  } finally {
    stopLocal();
  }
}

/**
 * Persists the EARNED EVOLUTION FACT the AUTHORITY computed.
 *
 * `type` is the only thing the caller contributes, and only as the name of
 * the transition it is asking about. Every figure that lands in the immutable
 * ledger — levels, quality, session count, adherence in basis points — comes
 * from the authority grant, and `firestore.rules` refuses any payload that
 * disagrees with that grant. A client can therefore neither grant itself an
 * evolution nor record a flattering number for one it legitimately earned.
 */
async function persistEarnedFact(input: {
  uid: string;
  lifecycle: NonNullable<Awaited<ReturnType<typeof loadWorkoutLifecycle>>>;
  type: PendingEvolutionType;
}): Promise<EarnedEvolutionFact> {
  // The local decision is the TRIGGER for asking, never the answer. Only the
  // transition's identity is claimed — `type`, so the authority can refuse a
  // request for a transition the account has not earned — and no counters at
  // all. Sending our own `sessionsCompletedAtEarn`/`adherenceAtEarnBp` is
  // exactly what used to make two honest app builds mutually exclusive: the
  // authority compared them byte-for-byte and rejected a legitimate EARN as
  // forged over a one-basis-point rounding difference. The authority
  // recomputes everything and hands back the figures AND the event identity;
  // `firestore.rules` then refuses any ledger payload that disagrees with the
  // grant, so these are the only values that can ever be persisted.
  const grant = await authorizeWorkoutLifecycleMutation({
    operation: 'EARN',
    sourceProgramInstanceId: input.lifecycle.programInstance.programInstanceId,
    sourceCycleId: input.lifecycle.cycle.cycleId,
    sourcePrescriptionInputSnapshotId: input.lifecycle.programInstance.prescriptionInputSnapshot?.snapshotId
      ?? `legacy:${input.lifecycle.programInstance.programInstanceId}`,
    earnedFact: { type: input.type },
  });
  const earned = grant?.earned;
  if (!earned) throw new Error('WORKOUT_LIFECYCLE_EARNED_FACT_NOT_GRANTED');
  const eventType = earned.eventType;
  const targetEventRef = eventRef(input.uid, earned.eventId);
  // Everything written below comes from `earned.fact` — the server's own
  // recomputation — so a client build whose local arithmetic differs still
  // persists the authoritative numbers.
  const authoritativeFact = earned.fact;
  try {
    await runTransaction(db, async (transaction) => {
      const [stateSnapshot, existingEvent] = await Promise.all([
        transaction.get(lifecycleRef(input.uid)),
        transaction.get(targetEventRef),
      ]);
      if (existingEvent.exists()) {
        transaction.delete(authorityGrantRef(input.uid));
        return;
      }
      if (!stateSnapshot.exists()) throw new Error('WORKOUT_LIFECYCLE_NOT_INITIALIZED');
      const state = stateSnapshot.data();
      if (
        state.activeProgramInstanceId !== input.lifecycle.programInstance.programInstanceId
        || state.currentCycleId !== input.lifecycle.cycle.cycleId
      ) throw new Error('WORKOUT_LIFECYCLE_STALE_EARN_BASE');
      const nowTs = serverTimestamp();
      transaction.set(targetEventRef, {
        eventId: earned.eventId,
        type: eventType,
        occurredAt: nowTs,
        cycleId: input.lifecycle.cycle.cycleId,
        programInstanceId: input.lifecycle.programInstance.programInstanceId,
        idempotencyKey: earned.idempotencyKey,
        payload: {
          evolutionType: authoritativeFact.type,
          quality: authoritativeFact.quality,
          fromLevel: authoritativeFact.fromLevel,
          toLevel: authoritativeFact.toLevel,
          sessionsCompletedAtEarn: authoritativeFact.sessionsCompletedAtEarn,
          adherenceAtEarnBp: authoritativeFact.adherenceAtEarnBp,
        },
        schemaVersion: WORKOUT_LIFECYCLE_SCHEMA_VERSION,
      });
      // Earning is an immutable ledger fact, not an active lifecycle
      // transition. `currentTrainingLevel` moves only when activation also
      // installs the matching TrainingCycle and ProgramInstance. This keeps
      // lifecycle/cycle semantics coherent and makes an isolated owner write
      // indistinguishable from an attack rather than a supported state.
      transaction.delete(authorityGrantRef(input.uid));
    });
  } catch (error) {
    const converged = await loadOutstandingEarnedFact(input.uid).catch(() => null);
    if (!converged || converged.idempotencyKey !== earned.idempotencyKey) throw error;
    return converged;
  }
  const persisted = await loadOutstandingEarnedFact(input.uid);
  if (!persisted || persisted.idempotencyKey !== earned.idempotencyKey) {
    throw new Error('WORKOUT_LIFECYCLE_EARNED_FACT_PERSIST_FAILED');
  }
  return persisted;
}

/**
 * The Fase 4 Lifecycle Orchestrator's PREPARE step (docs §6/§9/§22):
 * evaluate Progression V2 (pure), and if it earned a transition, call the
 * Prescription Evolution Engine (pure) and persist the result as a pending
 * evolution — WITHOUT activating it. Current Program Instance remains
 * active throughout (docs §10/§84).
 *
 * Idempotent: a pending evolution already existing short-circuits before
 * ever re-evaluating progression (docs §14/§53/§94 — no evaluation loop
 * while a transition is outstanding).
 */
async function prepareEvolutionAttempt(input: { uid: string; now?: Date }): Promise<PrepareEvolutionResult> {
  recordPerfMark('evolution_prepare_attempt_entered');
  const stopTotal = startPerfTimer('evolution_prepare.total');
  try {
    const now = input.now ?? new Date();

    const existingPending = await measurePrepareStep(
      'evolution_prepare.pending_read',
      () => loadPendingEvolution(input.uid),
    );
    if (existingPending) return { status: 'ALREADY_PENDING', pending: existingPending };

    let earnedFact = await measurePrepareStep(
      'evolution_prepare.outstanding_total',
      () => loadOutstandingEarnedFact(input.uid),
    );
    if (!earnedFact) {
      const decision = await measurePrepareStep(
        'evolution_prepare.evaluate_progression',
        () => evaluateProgressionV2ForUser(input.uid, now),
      );
    // Phase 4.2: this is the SAME evaluateProgressionV2ForUser call that
    // useWorkoutEvolution.load()'s outer Promise.all makes again right
    // after reconcile returns — same uid, no write in between when this
    // branch resolves NO_ACTION/PROGRESS_CONTINUES below. See perf marks.
      recordPerfMark('evolution_reconcile_progression_eval_ready');
      const stopDecisionLocal = startPerfTimer('evolution_prepare.local_decision');
      const noAction = !decision || decision.type === 'NO_ACTION' || decision.type === 'PROGRESS_CONTINUES';
      stopDecisionLocal();
      if (noAction) return { status: 'NO_ACTION', decision };

      const lifecycleAtEarn = await measurePrepareStep(
        'evolution_prepare.lifecycle_at_earn',
        () => loadWorkoutLifecycle(input.uid),
      );
      if (!lifecycleAtEarn) return { status: 'NO_LIFECYCLE' };
      const stopEarnedFactLocal = startPerfTimer('evolution_prepare.earned_fact_local');
      // Only the TRANSITION TYPE is derived locally, and only so the request
      // can name which transition it is asking about — the authority refuses
      // a request for anything it did not itself compute as earned. Levels,
      // quality, session count and adherence are deliberately NOT derived
      // here: they come back from the authority and are the only values
      // `persistEarnedFact` is allowed to write (see its doc comment).
      const type: PendingEvolutionType = decision.type === 'LEVEL_PROMOTION_ELIGIBLE'
        ? 'LEVEL_PROMOTION'
        : decision.type === 'EVOLUTION_ELIGIBLE' ? 'CYCLE_EVOLUTION' : 'MOTIVATIONAL_RENEWAL';
      stopEarnedFactLocal();
      earnedFact = await measurePrepareStep(
        'evolution_prepare.persist_earned_fact',
        () => persistEarnedFact({ uid: input.uid, lifecycle: lifecycleAtEarn, type }),
      );
    }

    const lifecycle = await measurePrepareStep(
      'evolution_prepare.lifecycle_for_prepare',
      () => loadWorkoutLifecycle(input.uid),
    );
    if (!lifecycle) return { status: 'NO_LIFECYCLE' };
    const { type, fromLevel, toLevel, quality, idempotencyKey } = earnedFact;

    const evolutionResult = await measurePrepareStep(
      'evolution_prepare.evolve_prescription',
      () => type === 'LEVEL_PROMOTION'
        ? evolvePrescription({ uid: input.uid, mode: 'LEVEL_PROMOTION', targetLevel: toLevel as LevelPromotionTarget })
        : evolvePrescription({ uid: input.uid, mode: type, targetCycleIdentity: idempotencyKey }),
    );

  if (evolutionResult.status !== 'SUCCESS') {
    logWorkoutLifecycleEvent({
      name: 'progression_failed', stage: 'PREPARATION',
      errorCategory: evolutionResult.reasonCodes[0] ?? 'UNKNOWN', retryable: false,
    });
    return { status: 'PREPARATION_FAILED', reasonCodes: evolutionResult.reasonCodes };
  }

    const stopCandidateLocal = startPerfTimer('evolution_prepare.candidate_local');
  const candidateTargetContentIdentity = contentIdentityFor({
    questionnaireId: evolutionResult.questionnaireId,
    questionnaireVersion: evolutionResult.questionnaireVersion,
    plan: evolutionResult.plan,
    template: {
      id: evolutionResult.templateId as TemplateId,
      version: evolutionResult.templateVersion,
      contentHash: evolutionResult.templateContentHash,
    },
  });

  const targetProgramInstanceId = programInstanceIdForOperation(`activation:${idempotencyKey}`);
  const pendingEvolutionId = pendingEvolutionIdForOperation(idempotencyKey);
  const pendingRef = pendingEvolutionRef(input.uid);
  const stateRef = lifecycleRef(input.uid);
  const sourceSnapshotId = lifecycle.programInstance.prescriptionInputSnapshot?.snapshotId
    ?? `legacy:${lifecycle.programInstance.programInstanceId}`;
  const sourceInstanceRef = doc(db, USERS, input.uid, 'programInstances', lifecycle.programInstance.programInstanceId);
    stopCandidateLocal();

  const authorityResult = await measurePrepareStep('evolution_prepare.authorize', () => authorizeWorkoutLifecycleMutation({
    operation: 'PREPARE',
    sourceProgramInstanceId: lifecycle.programInstance.programInstanceId,
    sourceCycleId: lifecycle.cycle.cycleId,
    sourcePrescriptionInputSnapshotId: sourceSnapshotId,
    targetProgramInstanceId,
    targetContentIdentity: candidateTargetContentIdentity,
    targetPrescriptionIdentity: evolutionResult.plan.planId,
    pendingEvolutionId,
    targetPlan: withoutUndefined(evolutionResult.plan) as unknown as Record<string, unknown>,
    targetPrescriptionInputSnapshot: evolutionResult.prescriptionInputSnapshot as unknown as Record<string, unknown>,
    earnedFact: {
      type, fromLevel, toLevel, quality,
      sessionsCompletedAtEarn: earnedFact.sessionsCompletedAtEarn,
      adherenceAtEarnBp: earnedFact.adherenceAtEarnBp,
    },
  }));
    const stopCanonicalLocal = startPerfTimer('evolution_prepare.canonical_local');
  const canonical = requireWorkoutLifecycleCanonical(authorityResult, 'PREPARE');
  const canonicalTemplate = {
    id: canonical.targetPlan.templateId as TemplateId,
    version: canonical.targetTemplateVersion,
    contentHash: canonical.targetTemplateContentHash,
  };
  // Single source of truth (docs/workout-lifecycle/v2/qa/ — root-cause fix
  // for a real device bug): `pending.plan` is written as `withoutUndefined(
  // canonical.targetPlan)`, a DIFFERENT object from `canonical.targetPlan`
  // itself. Hashing the latter while persisting the former let the frozen
  // `targetContentIdentity` silently stop matching the Pending's own
  // content — the backend's `activation_does_not_match_authoritative_
  // pending` check then (correctly) denied ACTIVATE. `persistedTargetPlan`
  // is computed exactly once and is the ONLY plan object either hashed or
  // written below, so the two can never diverge again.
  const persistedTargetPlan = withoutUndefined(canonical.targetPlan);
  const targetContentIdentity = contentIdentityFor({
    questionnaireId: evolutionResult.questionnaireId,
    questionnaireVersion: evolutionResult.questionnaireVersion,
    plan: persistedTargetPlan,
    template: canonicalTemplate,
  });
  if (
    canonical.targetPrescriptionIdentity !== persistedTargetPlan.planId
    || canonical.targetContentIdentity !== targetContentIdentity
  ) {
    throw new Error('WORKOUT_LIFECYCLE_CANONICAL_IDENTITY_INVALID');
  }

  // Defensive invariant, intentionally redundant with the single-source-of-
  // truth fix above: recompute the identity one more time from the EXACT
  // plan object about to be persisted, immediately before the write. Its
  // only job is to make a future edit that reintroduces two divergent plan
  // representations fail loudly and diagnosably during PREPARE, instead of
  // surfacing later as a device-specific `permission-denied` during
  // ACTIVATE. Must never succeed in persisting an inconsistent Pending.
  if (contentIdentityFor({
    questionnaireId: evolutionResult.questionnaireId,
    questionnaireVersion: evolutionResult.questionnaireVersion,
    plan: persistedTargetPlan,
    template: canonicalTemplate,
  }) !== targetContentIdentity) {
    throw new Error('WORKOUT_LIFECYCLE_PENDING_IDENTITY_INCONSISTENT');
  }
    stopCanonicalLocal();

  try {
    await measurePrepareStep('evolution_prepare.transaction', () => runTransaction(db, async (transaction) => {
      const [pendingSnapshot, stateSnapshot, sourceInstanceSnapshot] = await Promise.all([
        transaction.get(pendingRef),
        transaction.get(stateRef),
        transaction.get(sourceInstanceRef),
      ]);
      if (pendingSnapshot.exists()) {
        transaction.delete(authorityGrantRef(input.uid));
        return; // converged — another caller already prepared this exact evolution.
      }
      if (!stateSnapshot.exists()) throw new Error('WORKOUT_LIFECYCLE_NOT_INITIALIZED');
      const state = stateSnapshot.data();
      if (
        state.activeProgramInstanceId !== lifecycle.programInstance.programInstanceId
        || state.currentCycleId !== lifecycle.cycle.cycleId
      ) throw new Error('WORKOUT_LIFECYCLE_STALE_PREPARE_BASE');
      if (!sourceInstanceSnapshot.exists()) throw new Error('WORKOUT_LIFECYCLE_STALE_PREPARE_BASE');
      const persistedSourceSnapshotId = sourceInstanceSnapshot.data().prescriptionInputSnapshot?.snapshotId
        ?? `legacy:${lifecycle.programInstance.programInstanceId}`;
      if (persistedSourceSnapshotId !== sourceSnapshotId) {
        throw new Error('WORKOUT_LIFECYCLE_STALE_PREPARE_INPUTS');
      }

      const nowTs = serverTimestamp();
      transaction.set(pendingRef, {
      pendingEvolutionId,
      type,
      sourceCycleId: lifecycle.cycle.cycleId,
      sourceProgramInstanceId: lifecycle.programInstance.programInstanceId,
      sourcePrescriptionInputSnapshotId: sourceSnapshotId,
      fromLevel,
      toLevel,
      quality,
      sessionsCompletedAtEarn: earnedFact.sessionsCompletedAtEarn,
      adherenceAtEarnBp: earnedFact.adherenceAtEarnBp,
      plan: persistedTargetPlan,
      targetContentIdentity,
      targetPrescriptionIdentity: canonical.targetPrescriptionIdentity,
      targetProgramInstanceId,
      targetQuestionnaireId: evolutionResult.questionnaireId,
      targetQuestionnaireVersion: evolutionResult.questionnaireVersion,
      targetPrescriptionInputSnapshot: evolutionResult.prescriptionInputSnapshot,
      targetTemplateId: persistedTargetPlan.templateId,
      targetTemplateVersion: canonical.targetTemplateVersion,
      targetTemplateSourceVersion: canonical.targetTemplateSourceVersion,
      targetTemplateContentHash: canonical.targetTemplateContentHash,
      earnedAt: earnedFact.earnedAt,
      status: earnedFact.deferralCount === 0 ? 'READY' : 'DEFERRED',
      deferralCount: earnedFact.deferralCount,
      nextPromptAt: earnedFact.nextPromptAt,
      autoActivateAt: earnedFact.autoActivateAt,
      idempotencyKey,
      schemaVersion: WORKOUT_LIFECYCLE_SCHEMA_VERSION,
      createdAt: nowTs,
      updatedAt: nowTs,
      });
      transaction.delete(authorityGrantRef(input.uid));
    }));
  } catch (error) {
    const converged = await loadPendingEvolution(input.uid).catch(() => null);
    if (converged?.idempotencyKey === idempotencyKey) {
      return { status: 'ALREADY_PENDING', pending: converged };
    }
    const current = await loadWorkoutLifecycle(input.uid).catch(() => null);
    if (current && (
      current.programInstance.programInstanceId !== lifecycle.programInstance.programInstanceId
      || current.cycle.cycleId !== lifecycle.cycle.cycleId
    )) {
      logWorkoutLifecycleEvent({
        name: 'progression_failed', stage: 'PREPARATION', errorCategory: 'STALE_PREPARE', retryable: true,
      });
      return { status: 'PREPARATION_FAILED', reasonCodes: ['STALE_PREPARE_REJECTED_RETRYABLE'] };
    }
    logWorkoutLifecycleEvent({
      name: 'progression_failed', stage: 'PREPARATION',
      errorCategory: workoutLifecycleErrorCategory(error), retryable: true,
    });
    throw error;
  }

  const created = await measurePrepareStep(
    'evolution_prepare.created_pending_read',
    () => loadPendingEvolution(input.uid),
  );
  if (!created) throw new Error('PENDING_EVOLUTION_PERSIST_FAILED');
  return { status: 'PREPARED', pending: created };
  } finally {
    stopTotal();
    recordPerfMark('evolution_prepare_attempt_returned');
  }
}

// ─── DEFER ──────────────────────────────────────────────────────────────

/**
 * A grant is deliberately single-use. A different lifecycle command may
 * replace it after this caller has computed its transition but before its
 * transaction commits. Recompute from authoritative state so benign
 * cross-device races converge without ever reusing stale prescription data.
 *
 * Bounded convergence (docs/workout-lifecycle/v2/architecture/
 * 22_POST_PHASE_10C_FINAL_ADVERSARIAL_AUDIT.md §34/§49.2): a single retry was
 * not always enough — under sustained load a concurrent ADAPT can still be
 * committing across both attempts, so `prepareEvolutionAttempt`'s own
 * staleness convergence check can fail twice in a row for an otherwise
 * benign race. Exactly `MAX_ATTEMPTS` attempts total — never retried beyond
 * this — then an explicit, retryable outcome is returned instead of an
 * unhandled rejection reaching the caller.
 */
const PREPARE_EVOLUTION_MAX_ATTEMPTS = 3;

export async function prepareEvolution(input: { uid: string; now?: Date }): Promise<PrepareEvolutionResult> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= PREPARE_EVOLUTION_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await prepareEvolutionAttempt(input);
    } catch (error) {
      lastError = error;
    }
  }
  const converged = await loadPendingEvolution(input.uid).catch(() => null);
  if (converged) return { status: 'ALREADY_PENDING', pending: converged };
  logWorkoutLifecycleEvent({
    name: 'progression_failed', stage: 'PREPARATION',
    errorCategory: workoutLifecycleErrorCategory(lastError), retryable: true,
  });
  return { status: 'PREPARATION_FAILED', reasonCodes: ['STALE_PREPARE_REJECTED_RETRYABLE'] };
}

// ─── QA_TRANSITION ──────────────────────────────────────────────────────
// docs/workout-lifecycle/v2/qa/ — replaces ONLY the eligibility decision
// (`authoritativeEarnedFact`'s activeDays/adherence gate, server-side).
// Everything downstream — canonical prescription generation, ProgramInstance,
// TrainingCycle, PendingEvolution, defer/activate — is the exact same
// pipeline a real earned transition uses (`prepareEvolution` below, called
// completely unmodified once the EARN ledger event exists).

export interface QaTransitionPreview {
  currentLevel: CurrentTrainingLevel;
  currentCycleNumber: number;
  currentProgramInstanceId: string;
  currentContentIdentity: string;
  /** Derived from the account's REAL currentTrainingLevel/earned-cycle history — never chosen by the caller. */
  targetType: 'LEVEL_PROMOTION' | 'CYCLE_EVOLUTION';
  targetLevel: CurrentTrainingLevel;
}

/**
 * Read-only preview of what "Preparar próxima evolução" would target,
 * using the exact same branching `authoritativeEarnedFact` uses server-side
 * (BEGINNER -> INTERMEDIATE; INTERMEDIATE -> ADVANCED only at the 4th
 * earned cycle, else another INTERMEDIATE cycle; ADVANCED -> another
 * ADVANCED cycle, never a new terminal level). Never lets a caller pick the
 * target — this only reports what the real career rules already decided.
 */
export async function previewQaTransition(uid: string): Promise<QaTransitionPreview | null> {
  const lifecycle = await loadWorkoutLifecycle(uid);
  if (!lifecycle) return null;
  const currentLevel = lifecycle.lifecycle.currentTrainingLevel;
  const earnedIntermediateCycleCount = currentLevel === 'INTERMEDIATE'
    ? countEarnedIntermediateCycles(await listTrainingCycles(uid))
    : 0;
  let targetType: 'LEVEL_PROMOTION' | 'CYCLE_EVOLUTION' = 'CYCLE_EVOLUTION';
  let targetLevel = currentLevel;
  if (currentLevel === 'BEGINNER') {
    targetType = 'LEVEL_PROMOTION';
    targetLevel = 'INTERMEDIATE';
  } else if (currentLevel === 'INTERMEDIATE') {
    if (earnedIntermediateCycleCount + 1 >= PROGRESSION_V2_CONFIG.intermediateCyclesForPromotion) {
      targetType = 'LEVEL_PROMOTION';
      targetLevel = 'ADVANCED';
    } else {
      targetType = 'CYCLE_EVOLUTION';
    }
  } else {
    targetType = 'CYCLE_EVOLUTION'; // ADVANCED never gets a new terminal level.
  }
  return {
    currentLevel,
    currentCycleNumber: lifecycle.lifecycle.currentCycleNumber,
    currentProgramInstanceId: lifecycle.programInstance.programInstanceId,
    currentContentIdentity: lifecycle.lifecycle.activeContentIdentity,
    targetType,
    targetLevel,
  };
}

/**
 * The "Preparar próxima evolução" action (Settings > Developer > Workout
 * Lifecycle, QA_TRANSITION only). Falsifies exactly one thing — "this
 * account earned the right to request its next evolution" — and nothing
 * about how that evolution happens:
 *
 *   1. If no EVOLUTION_EARNED ledger event is already outstanding, derive
 *      the real target (`previewQaTransition`) and the account's REAL
 *      current adherence/valid-session numbers (`evaluateProgressionV2ForUserFull`
 *      — completely unaffected by QA), then request EARN with those real
 *      numbers plus a `qaForced`/`triggerSource` marker. The backend
 *      independently re-derives the same target from the same real state
 *      and only skips its own activeDays/adherence check when this
 *      account's `workoutLifecycleQaMode` is actually `TRANSITION` — a
 *      non-QA_TRANSITION account sending this fails closed with
 *      `forged_earned_fact`, no special-casing needed here.
 *   2. Delegate to `prepareEvolution` — the exact same, unmodified real
 *      PREPARE pipeline (canonical prescription, ProgramInstance,
 *      PendingEvolution) a genuinely earned transition uses.
 *
 * Never writes `currentTrainingLevel`, `earnedIntermediateCycles`, or a
 * `PendingEvolution` directly — every one of those is still produced by the
 * real backend-authoritative pipeline, just triggered earlier than a real
 * career would allow.
 */
export async function prepareQaTransitionEvolution(input: { uid: string; now?: Date }): Promise<PrepareEvolutionResult> {
  const existingPending = await loadPendingEvolution(input.uid);
  if (existingPending) return { status: 'ALREADY_PENDING', pending: existingPending };

  const existingEarned = await loadOutstandingEarnedFact(input.uid);
  if (!existingEarned) {
    const lifecycle = await loadWorkoutLifecycle(input.uid);
    if (!lifecycle) return { status: 'NO_LIFECYCLE' };
    const preview = await previewQaTransition(input.uid);
    if (!preview) return { status: 'NO_LIFECYCLE' };
    // Identical to the real path: only the transition TYPE is named, and the
    // authority supplies every figure — including the `qaForced`/
    // `triggerSource` markers, which it adds itself when the account really
    // is in `QA_TRANSITION` mode. A non-QA account asking for this still
    // fails closed inside `authoritativeEarnedFact`.
    await persistEarnedFact({ uid: input.uid, lifecycle, type: preview.targetType });
  }

  return prepareEvolution({ uid: input.uid, now: input.now });
}

export type DeferEvolutionResult =
  | { status: 'NO_PENDING_EVOLUTION' }
  | { status: 'CANNOT_DEFER' }
  | { status: 'DEFERRED'; pending: PendingEvolution<Timestamp> };

/** First deferral opens a 14-day second window; second (final) deferral opens the auto-activation deadline instead (docs §25-29, ADR-009). */
export async function deferPendingEvolution(input: { uid: string; now?: Date }): Promise<DeferEvolutionResult> {
  const now = input.now ?? new Date();
  const pendingRef = pendingEvolutionRef(input.uid);
  let outcome: DeferEvolutionResult | null = null;
  const preflightPending = await loadPendingEvolution(input.uid);
  if (!preflightPending) return { status: 'NO_PENDING_EVOLUTION' };
  const deferralConfig = resolveDeferralConfig(await resolveWorkoutLifecycleProgressionPolicy(input.uid));
  await authorizeWorkoutLifecycleMutation({
    operation: 'DEFER',
    sourceProgramInstanceId: preflightPending.sourceProgramInstanceId,
    sourceCycleId: preflightPending.sourceCycleId,
    pendingEvolutionId: preflightPending.pendingEvolutionId,
    eventType: 'EVOLUTION_DEFERRED',
    idempotencyKey: `${preflightPending.idempotencyKey}:defer:${preflightPending.deferralCount + 1}`,
    eventId: lifecycleEventId(
      'EVOLUTION_DEFERRED',
      `${preflightPending.idempotencyKey}:defer:${preflightPending.deferralCount + 1}`,
    ),
  });

  try {
    await runTransaction(db, async (transaction) => {
      const snapshot = await transaction.get(pendingRef);
      if (!snapshot.exists()) {
        outcome = { status: 'NO_PENDING_EVOLUTION' };
        transaction.delete(authorityGrantRef(input.uid));
        return;
      }
      const data = snapshot.data() as PendingEvolution<Timestamp>;
      const view = toDeferralView({
        pendingEvolutionId: data.pendingEvolutionId,
        status: data.status,
        deferralCount: data.deferralCount,
        nextPromptAt: data.nextPromptAt ? data.nextPromptAt.toDate() : null,
        autoActivateAt: data.autoActivateAt ? data.autoActivateAt.toDate() : null,
      });
      if (!canDefer(view, now, deferralConfig)) {
        outcome = { status: 'CANNOT_DEFER' };
        transaction.delete(authorityGrantRef(input.uid));
        return;
      }
      const transition = applyDefer(view, now, deferralConfig);
      const nowTs = serverTimestamp();
      transaction.update(pendingRef, {
        status: transition.status,
        deferralCount: transition.deferralCount,
        nextPromptAt: transition.nextPromptAt ? Timestamp.fromDate(transition.nextPromptAt) : null,
        autoActivateAt: transition.autoActivateAt ? Timestamp.fromDate(transition.autoActivateAt) : null,
        updatedAt: nowTs,
      });
      const deferIdempotencyKey = `${data.idempotencyKey}:defer:${transition.deferralCount}`;
      const eventId = lifecycleEventId('EVOLUTION_DEFERRED', deferIdempotencyKey);
      transaction.set(eventRef(input.uid, eventId), {
        eventId,
        type: 'EVOLUTION_DEFERRED',
        occurredAt: nowTs,
        cycleId: data.sourceCycleId,
        programInstanceId: data.sourceProgramInstanceId,
        idempotencyKey: deferIdempotencyKey,
        payload: {
          deferralCount: transition.deferralCount,
          nextPromptAtMs: transition.nextPromptAt?.getTime() ?? null,
          autoActivateAtMs: transition.autoActivateAt?.getTime() ?? null,
        },
        schemaVersion: WORKOUT_LIFECYCLE_SCHEMA_VERSION,
      });
      transaction.delete(authorityGrantRef(input.uid));
    });
  } catch (error) {
    // Two concurrent defer calls (double tap, or two devices) can both pass
    // the pure `canDefer` check against the same pre-write state; only one
    // commits, and Firestore Rules reject the loser's stale `deferralCount ==
    // resource.data.deferralCount + 1` at commit time as PERMISSION_DENIED
    // rather than a retryable ABORTED (docs Fase 6 §44/AE). Converge instead
    // of surfacing a raw error for what is, from the user's single shared
    // pendingEvolutions/current doc, a benign race — never invent a second
    // deferral on top of the one that actually landed.
    const reconciled = await loadPendingEvolution(input.uid).catch(() => null);
    if (!reconciled || reconciled.status !== 'DEFERRED') {
      logWorkoutLifecycleEvent({
        name: 'progression_failed', stage: 'DEFERRAL',
        errorCategory: workoutLifecycleErrorCategory(error), retryable: true,
      });
      throw error;
    }
    return { status: 'DEFERRED', pending: reconciled };
  }

  if (outcome) return outcome;
  const updated = await loadPendingEvolution(input.uid);
  if (!updated) return { status: 'NO_PENDING_EVOLUTION' };
  return { status: 'DEFERRED', pending: updated };
}

// ─── ACTIVATE ───────────────────────────────────────────────────────────

export type ActivateEvolutionResult =
  | { status: 'NO_PENDING_EVOLUTION' }
  | { status: 'NOT_DUE' }
  | { status: 'STALE_PENDING'; reasonCodes: string[] }
  | { status: 'ACTIVATED'; program: WorkoutProgramSnapshot };

/**
 * Manual ("START NOW") or automatic (post-deadline reconciliation)
 * activation of the pending evolution. Delegates the actual atomic
 * content+instance+cycle+lifecycle write to `saveAndActivateWorkoutProgram`
 * (extended in Fase 4 with `nextCycle`/`clearPendingEvolution`) — this
 * function only resolves WHICH transition to apply and validates the
 * pending evolution is still valid to activate (docs §34/§40-44).
 */
export async function activatePendingEvolution(input: {
  uid: string;
  now?: Date;
  trigger: 'MANUAL' | 'AUTO';
}): Promise<ActivateEvolutionResult> {
  const now = input.now ?? new Date();
  const pending = await loadPendingEvolution(input.uid);
  if (!pending) return { status: 'NO_PENDING_EVOLUTION' };

  if (input.trigger === 'AUTO') {
    const view = toDeferralView({
      pendingEvolutionId: pending.pendingEvolutionId,
      status: pending.status,
      deferralCount: pending.deferralCount,
      nextPromptAt: pending.nextPromptAt ? pending.nextPromptAt.toDate() : null,
      autoActivateAt: pending.autoActivateAt ? pending.autoActivateAt.toDate() : null,
    });
    if (!isAutoActivationDue(view, now)) return { status: 'NOT_DUE' };
  }

  const lifecycle = await loadWorkoutLifecycle(input.uid);
  if (!lifecycle) return { status: 'STALE_PENDING', reasonCodes: ['LIFECYCLE_MISSING'] };
  if (lifecycle.lifecycle.activeProgramInstanceId === pending.targetProgramInstanceId) {
    // Already activated by a concurrent caller — converge without a second write.
    return { status: 'ACTIVATED', program: await mustLoadActiveProgram(input.uid) };
  }
  if (lifecycle.programInstance.programInstanceId !== pending.sourceProgramInstanceId) {
    // The source Program Instance this evolution was prepared against is no
    // longer active (e.g. a Program Adaptation superseded it) — never
    // activate stale content blindly (docs §72/§108/§AX).
    return { status: 'STALE_PENDING', reasonCodes: ['SOURCE_PROGRAM_INSTANCE_CHANGED'] };
  }
  if (lifecycle.cycle.cycleId !== pending.sourceCycleId) {
    return { status: 'STALE_PENDING', reasonCodes: ['SOURCE_CYCLE_CHANGED'] };
  }
  if (
    pending.sourcePrescriptionInputSnapshotId
    && lifecycle.programInstance.prescriptionInputSnapshot?.snapshotId !== pending.sourcePrescriptionInputSnapshotId
  ) {
    return { status: 'STALE_PENDING', reasonCodes: ['SOURCE_PRESCRIPTION_INPUTS_CHANGED'] };
  }

  const template = await resolvePendingEvolutionTemplate(pending);
  if (
    !template
    || template.version !== pending.targetTemplateVersion
    || template.contentHash !== pending.targetTemplateContentHash
  ) {
    return { status: 'STALE_PENDING', reasonCodes: ['TEMPLATE_CHANGED'] };
  }

  const eventType = pending.type === 'LEVEL_PROMOTION'
    ? 'LEVEL_PROMOTED'
    : pending.type === 'MOTIVATIONAL_RENEWAL'
      ? 'MOTIVATIONAL_RENEWAL_ACTIVATED'
      : 'EVOLUTION_ACTIVATED';

  const nextCycle = pending.type === 'MOTIVATIONAL_RENEWAL'
    ? undefined
    : pending.type === 'LEVEL_PROMOTION'
      ? { level: pending.toLevel, cycleNumber: 1, progressionReason: 'EARNED_LEVEL_PROMOTION' }
      : { level: pending.toLevel, cycleNumber: lifecycle.lifecycle.currentCycleNumber + 1, progressionReason: 'EARNED_CYCLE_EVOLUTION' };

  let targetPrescriptionInputSnapshot = pending.targetPrescriptionInputSnapshot;
  if (!targetPrescriptionInputSnapshot) {
    // Compatibility path for pending records prepared before the Phase 8A
    // snapshot schema existed. Never dereference a missing questionnaire or
    // silently synthesize prescription inputs when the source can no longer be
    // recovered.
    const authoritative = await loadAuthoritativePrescriptionInputs(input.uid, lifecycle);
    if (!authoritative) {
      return { status: 'STALE_PENDING', reasonCodes: ['PRESCRIPTION_INPUTS_UNAVAILABLE'] };
    }
    targetPrescriptionInputSnapshot = buildPrescriptionInputSnapshot({
      answers: questionnaireAnswersFromPrescriptionInputs(authoritative.snapshot.inputs),
      currentTrainingLevel: pending.toLevel,
      source: pending.type === 'LEVEL_PROMOTION'
        ? 'LEVEL_PROMOTION'
        : pending.type === 'MOTIVATIONAL_RENEWAL'
          ? 'MOTIVATIONAL_RENEWAL'
          : 'CYCLE_EVOLUTION',
    });
  }

  // Defensive telemetry (docs/workout-lifecycle/v2/qa/ — root-cause fix):
  // PREPARE now guarantees `pending.targetContentIdentity` is derived from
  // the exact object persisted as `pending.plan` (see the invariant in
  // `prepareEvolutionAttempt`), so this can only ever fire for a Pending
  // created before that fix shipped. Kept small and permanent (not
  // DEV-gated — cheap, and contains no plan/session/questionnaire content)
  // purely so a known legacy-broken Pending is distinguishable from a real
  // regression in production logs, without reproducing the heavy forensic
  // diagnostic that found this bug.
  const activateContentIdentity = contentIdentityFor({
    questionnaireId: pending.targetQuestionnaireId,
    questionnaireVersion: pending.targetQuestionnaireVersion,
    plan: pending.plan as Parameters<typeof saveAndActivateWorkoutProgram>[0]['plan'],
    template: { id: template.id, version: template.version, contentHash: template.contentHash },
  });
  if (activateContentIdentity !== pending.targetContentIdentity) {
    logWarn('workout_evolution', 'pending_content_identity_inconsistent', {
      pendingEvolutionId: pending.pendingEvolutionId,
    });
  }

  try {
    const program = await saveAndActivateWorkoutProgram({
      uid: input.uid,
      questionnaireId: pending.targetQuestionnaireId,
      questionnaireVersion: pending.targetQuestionnaireVersion,
      plan: pending.plan as Parameters<typeof saveAndActivateWorkoutProgram>[0]['plan'],
      template,
      prescriptionInputSnapshot: targetPrescriptionInputSnapshot,
      source: 'evolution_activation',
      lifecycleIdempotencyKey: pending.idempotencyKey,
      expectedActiveProgramInstanceId: pending.sourceProgramInstanceId,
      expectedCycleId: pending.sourceCycleId,
      expectedPrescriptionInputSnapshotId: pending.sourcePrescriptionInputSnapshotId,
      nextCycle,
      eventType,
      eventPayload: { evolutionType: pending.type, quality: pending.quality, trigger: input.trigger },
      clearPendingEvolution: true,
      expectedPendingEvolutionId: pending.pendingEvolutionId,
    });
    return { status: 'ACTIVATED', program };
  } catch (error) {
    // A concurrent safety-relevant Program Adaptation (docs §47/§48/AJ) can
    // supersede this pending's source Program Instance between our read above
    // and the write below — that must always lose to safety, never activate
    // stale/incompatible prescription content. Re-check rather than assume:
    // only report STALE_PENDING once the lifecycle genuinely no longer points
    // at the source this evolution was prepared against; any other failure
    // is a real error and must not be swallowed.
    const relifecycle = await loadWorkoutLifecycle(input.uid).catch(() => null);
    if (relifecycle && relifecycle.programInstance.programInstanceId !== pending.sourceProgramInstanceId) {
      return { status: 'STALE_PENDING', reasonCodes: ['SOURCE_PROGRAM_INSTANCE_CHANGED_CONCURRENTLY'] };
    }
    const repending = await loadPendingEvolution(input.uid).catch(() => null);
    if (!repending || repending.pendingEvolutionId !== pending.pendingEvolutionId) {
      return { status: 'STALE_PENDING', reasonCodes: ['PENDING_INVALIDATED_CONCURRENTLY'] };
    }
    logWorkoutLifecycleEvent({
      name: 'progression_failed', stage: 'ACTIVATION',
      errorCategory: workoutLifecycleErrorCategory(error), retryable: true,
    });
    throw error;
  }
}

async function mustLoadActiveProgram(uid: string): Promise<WorkoutProgramSnapshot> {
  const program = await loadActiveWorkoutProgram(uid);
  if (!program) throw new Error('WORKOUT_LIFECYCLE_ACTIVE_PROGRAM_MISSING');
  return program;
}

// ─── RECONCILE ──────────────────────────────────────────────────────────

export interface ReconcileResult {
  prepared: boolean;
  autoActivated: boolean;
  staleClearedPendingEvolution: boolean;
  program?: WorkoutProgramSnapshot;
  /**
   * The `ProgressionDecision` this reconcile computed while deciding whether
   * to prepare an evolution — present ONLY when the outcome was `NO_ACTION`
   * (nothing was written). `useWorkoutEvolution.load()` reuses this instead
   * of calling `evaluateProgressionV2ForUser` a second time for the exact
   * same uid/instant. Absent (not merely `null`) whenever this reconcile
   * either didn't reach that evaluation at all, or DID write something
   * (PREPARED/AUTO_ACTIVATED/stale-cleared) — in every such case the
   * decision would be stale relative to the state `load()` is about to read
   * fresh, so it must NOT be reused; callers should treat "field absent"
   * and "field is `undefined`" identically to "must recompute".
   */
  progressionDecision?: ProgressionDecision | null;
  /**
   * The lifecycle bundle this reconciliation already loaded internally —
   * populated ONLY in branches that are provably still valid when reconcile
   * returns (no write happened after this exact object was captured), i.e.
   * the same NO_ACTION/STALE_REPREPARED branches that populate
   * `progressionDecision` above, and for the identical reason.
   * `useWorkoutEvolution.load()` reuses this instead of re-reading the same
   * document a few hundred ms later. Absent (not merely `null`) in every
   * branch where a write occurred after this bundle was captured — callers
   * MUST treat "field absent" as "re-fetch", never substitute a stale one.
   */
  lifecycle?: NonNullable<Awaited<ReturnType<typeof loadWorkoutLifecycle>>>;
}

export interface PostWorkoutLifecycleResult extends ReconcileResult {
  status: 'PROCESSED';
}

/**
 * The single production post-workout authority. The workout execution and
 * schedule completion have already committed before this function runs, so
 * callers may safely retry it after an offline/unknown result. All lifecycle
 * work is delegated to the same idempotent reconciliation path used on cold
 * start; V1 progression is intentionally absent from this boundary.
 */
export async function processWorkoutLifecycleAfterSession(input: {
  uid: string;
  now?: Date;
}): Promise<PostWorkoutLifecycleResult> {
  const result = await reconcileWorkoutLifecycle({ ...input, trigger: 'POST_WORKOUT' });
  return { status: 'PROCESSED', ...result };
}

/**
 * Single entry point for "catch up the lifecycle" on any trusted runtime
 * entry (app start, readiness gate, post-workout) — never depends on the
 * app being open exactly at a deadline (docs §30-32/§75).
 */
export async function reconcileWorkoutLifecycle(input: {
  uid: string;
  now?: Date;
  trigger?: 'POST_WORKOUT' | 'COLD_START' | 'RECOVERY' | 'FOREGROUND';
}): Promise<ReconcileResult> {
  const now = input.now ?? new Date();
  const trigger = input.trigger ?? 'RECOVERY';
  logWorkoutLifecycleEvent({ name: 'lifecycle_reconcile_started', trigger });
  try {
    let recovery = await recoverWorkoutLifecyclePartialState(input.uid);
    recordPerfMark('evolution_reconcile_recovery_ready');
    if (recovery.classification === 'UNRECOVERABLE') {
      throw new Error('WORKOUT_LIFECYCLE_PARTIAL_STATE_UNRECOVERABLE');
    }
    if (recovery.recovered) {
      logWorkoutLifecycleEvent({ name: 'lifecycle_partial_state_recovered', classification: recovery.classification });
    }

    // NO_V2_STATE can still mean a valid legacy-only account. Loading the
    // active program is the one compatibility boundary that may consult the
    // legacy mirror; it creates the deterministic V2 baseline before any
    // progression decision. This makes migration/workout-finish and cold-
    // start ordering converge on V2 rather than temporarily falling back to
    // V1 authority.
    if (recovery.classification === 'NO_V2_STATE') {
      await loadActiveWorkoutProgram(input.uid);
      recovery = await recoverWorkoutLifecyclePartialState(input.uid);
      if (recovery.classification === 'UNRECOVERABLE') {
        throw new Error('WORKOUT_LIFECYCLE_PARTIAL_STATE_UNRECOVERABLE');
      }
    }
    const lifecycle = recovery.lifecycle ?? await loadWorkoutLifecycle(input.uid);
    recordPerfMark('evolution_reconcile_lifecycle_ready');
    if (!lifecycle) {
      const result = { prepared: false, autoActivated: false, staleClearedPendingEvolution: false };
      logWorkoutLifecycleEvent({ name: 'lifecycle_reconcile_completed', trigger, outcome: 'NO_LIFECYCLE' });
      return result;
    }

    const pending = await loadPendingEvolution(input.uid);
    recordPerfMark('evolution_reconcile_pending_ready');
    if (!pending) {
    // Recovery: an eligible evolution may have been earned but never
    // prepared (crash before persistence) — safe to attempt, idempotent
    // either way (docs §76).
      const result = await prepareEvolution({ uid: input.uid, now });
      recordPerfMark('evolution_reconcile_prepare_ready');
      const response: ReconcileResult = {
        prepared: result.status === 'PREPARED',
        autoActivated: false,
        staleClearedPendingEvolution: false,
        ...(result.status === 'NO_ACTION' ? { progressionDecision: result.decision ?? null, lifecycle } : {}),
      };
      logWorkoutLifecycleEvent({ name: 'lifecycle_reconcile_completed', trigger, outcome: response.prepared ? 'PREPARED' : 'NO_ACTION' });
      return response;
    }

  if (lifecycle.lifecycle.activeProgramInstanceId === pending.targetProgramInstanceId) {
    // Activation already succeeded; only its own cleanup didn't run for some
    // external reason — clear it now (docs §77/§87).
      await authorizeWorkoutLifecycleMutation({
        operation: 'RECOVER',
        sourceProgramInstanceId: lifecycle.programInstance.programInstanceId,
        sourceCycleId: lifecycle.cycle.cycleId,
      });
      await runTransaction(db, async (transaction) => {
        transaction.delete(pendingEvolutionRef(input.uid));
        transaction.delete(authorityGrantRef(input.uid));
      }).catch(() => undefined);
      recordPerfMark('evolution_reconcile_cleanup_done');
      const response = { prepared: false, autoActivated: false, staleClearedPendingEvolution: true };
      logWorkoutLifecycleEvent({ name: 'lifecycle_reconcile_completed', trigger, outcome: 'NO_ACTION' });
      return response;
    }

  const currentSnapshotId = lifecycle.programInstance.prescriptionInputSnapshot?.snapshotId
    ?? `legacy:${lifecycle.programInstance.programInstanceId}`;
  const pendingIsStale = lifecycle.programInstance.programInstanceId !== pending.sourceProgramInstanceId
    || lifecycle.cycle.cycleId !== pending.sourceCycleId
    || (pending.sourcePrescriptionInputSnapshotId != null
      && pending.sourcePrescriptionInputSnapshotId !== currentSnapshotId);
    if (pendingIsStale) {
      const staleReason = lifecycle.programInstance.programInstanceId !== pending.sourceProgramInstanceId
        ? 'PROGRAM_INSTANCE'
        : lifecycle.cycle.cycleId !== pending.sourceCycleId
          ? 'CYCLE'
          : 'INPUT_SNAPSHOT';
      logWorkoutLifecycleEvent({ name: 'lifecycle_stale_prepare_rejected', reason: staleReason });
    // Compare-and-delete: never clear a newer pending that another caller may
    // have installed while this reconciliation was reading.
    await authorizeWorkoutLifecycleMutation({
      operation: 'RECOVER',
      sourceProgramInstanceId: lifecycle.programInstance.programInstanceId,
      sourceCycleId: lifecycle.cycle.cycleId,
      pendingEvolutionId: pending.pendingEvolutionId,
    });
    await runTransaction(db, async (transaction) => {
      const snapshot = await transaction.get(pendingEvolutionRef(input.uid));
      if (snapshot.exists() && snapshot.data().pendingEvolutionId === pending.pendingEvolutionId) {
        transaction.delete(pendingEvolutionRef(input.uid));
      }
      transaction.delete(authorityGrantRef(input.uid));
    });
      const reprepared = await prepareEvolution({ uid: input.uid, now });
      recordPerfMark('evolution_reconcile_cleanup_done');
      const response: ReconcileResult = {
        prepared: reprepared.status === 'PREPARED' || reprepared.status === 'ALREADY_PENDING',
        autoActivated: false,
        staleClearedPendingEvolution: true,
        ...(reprepared.status === 'NO_ACTION' ? { progressionDecision: reprepared.decision ?? null, lifecycle } : {}),
      };
      logWorkoutLifecycleEvent({ name: 'lifecycle_reconcile_completed', trigger, outcome: 'STALE_REPREPARED' });
      return response;
    }

  const view = toDeferralView({
    pendingEvolutionId: pending.pendingEvolutionId,
    status: pending.status,
    deferralCount: pending.deferralCount,
    nextPromptAt: pending.nextPromptAt ? pending.nextPromptAt.toDate() : null,
    autoActivateAt: pending.autoActivateAt ? pending.autoActivateAt.toDate() : null,
  });
    if (!isAutoActivationDue(view, now)) {
      recordPerfMark('evolution_reconcile_not_due');
      const response = { prepared: false, autoActivated: false, staleClearedPendingEvolution: false };
      logWorkoutLifecycleEvent({ name: 'lifecycle_reconcile_completed', trigger, outcome: 'NO_ACTION' });
      return response;
    }

  const activation = await activatePendingEvolution({ uid: input.uid, now, trigger: 'AUTO' });
    recordPerfMark('evolution_reconcile_activation_done');
    if (activation.status === 'ACTIVATED') {
      const response = { prepared: false, autoActivated: true, staleClearedPendingEvolution: false, program: activation.program };
      logWorkoutLifecycleEvent({ name: 'lifecycle_reconcile_completed', trigger, outcome: 'AUTO_ACTIVATED' });
      return response;
    }
    const response = { prepared: false, autoActivated: false, staleClearedPendingEvolution: false };
    logWorkoutLifecycleEvent({ name: 'lifecycle_reconcile_completed', trigger, outcome: 'NO_ACTION' });
    return response;
  } catch (error) {
    logWorkoutLifecycleEvent({
      name: 'lifecycle_reconcile_failed', trigger,
      errorCategory: workoutLifecycleErrorCategory(error), retryable: true,
    });
    logWorkoutLifecycleEvent({
      name: 'progression_failed', stage: 'RECONCILIATION',
      errorCategory: workoutLifecycleErrorCategory(error), retryable: true,
    });
    throw error;
  }
}

// ─── PROGRAM ADAPTATION ─────────────────────────────────────────────────

export type ProgramAdaptationReason = 'AVAILABILITY' | 'GOAL' | 'ENVIRONMENT' | 'PREFERENCE';

export type ProgramAdaptationResult =
  | { status: 'SUCCESS'; program: WorkoutProgramSnapshot }
  | { status: 'FAILED'; reasonCodes: string[] };

/**
 * Explicit Program Adaptation service boundary (docs prescription/06,
 * §56-74). NOT an evolution: preserves career level and TrainingCycle,
 * never increments earned-cycle credit, and always activates immediately —
 * changes to the user profile must never wait for a deferral
 * window (docs §65/§66/§AV/§AW). Always clears any pending evolution, since
 * it was prepared against constraints that no longer apply (docs §72/§74)
 * — the EARNED fact itself survives in the immutable event ledger.
 */
async function adaptWorkoutProgramAttempt(input: {
  uid: string;
  updatedFields: Partial<Omit<QuestionnaireAnswers, 'level'>>;
  reason: ProgramAdaptationReason;
  idempotencyKey: string;
}): Promise<ProgramAdaptationResult> {
  const program = await loadActiveWorkoutProgram(input.uid);
  if (!program) return { status: 'FAILED', reasonCodes: ['NO_ACTIVE_PROGRAM'] };
  const lifecycle = await loadWorkoutLifecycle(input.uid);
  if (!lifecycle) return { status: 'FAILED', reasonCodes: ['NO_LIFECYCLE'] };
  const authoritative = await loadAuthoritativePrescriptionInputs(input.uid, lifecycle);
  if (!authoritative) return { status: 'FAILED', reasonCodes: ['QUESTIONNAIRE_NOT_FOUND'] };

  // Adaptation never changes level — that is Level Promotion's exclusive
  // responsibility (docs §57/§AO type signature already excludes `level`,
  // this is the runtime mirror of that guarantee).
  const syntheticAnswers: QuestionnaireAnswers = {
    ...authoritative.answers,
    ...input.updatedFields,
    level: authoritative.answers.level,
  };
  // Frequency-change safety gate (docs §Mudança da frequência): a bare
  // `updatedFields: { days: M }` with a stale `trainingDays` left at the OLD
  // length reaches `engineV127`'s `normalizeWeekdays(trainingDays).length ===
  // availabilityDays` check, fails it silently, and seals a `fixed` program
  // with `weeklySchedule: []` — which `Array.isArray([])` lets straight
  // through every calendar-authority reader, trapping the user in REST_DAY
  // forever. `days` and `trainingDays` must always be changed together and
  // consistently; reject here, before the prescription engine ever runs,
  // rather than discovering it as a live scheduling outage.
  if (input.updatedFields.days != null) {
    const effectiveScheduleMode = syntheticAnswers.scheduleMode ?? 'fixed';
    const effectiveTrainingDays = syntheticAnswers.trainingDays ?? [];
    const frequencyTrainingDaysConsistent = effectiveScheduleMode === 'flexible'
      ? effectiveTrainingDays.length === 0
      : effectiveTrainingDays.length === input.updatedFields.days;
    if (!frequencyTrainingDaysConsistent) {
      return { status: 'FAILED', reasonCodes: ['FREQUENCY_TRAINING_DAYS_INCONSISTENT'] };
    }
    // Per-level weekly bounds (`onboarding/weeklyDayAllowance.ts`), checked
    // against the LIFECYCLE's `currentTrainingLevel` rather than the
    // questionnaire's stored `level` answer — the agenda sheet is keyed on
    // the same field, so this only ever fires for a caller that bypassed it.
    // Not the authority: `authorizeWorkoutLifecycleMutation` re-checks both
    // bounds server-side; this is the fast, diagnosable client-side failure.
    const maxWeeklyDays = maxWeeklyDaysForTrainingLevel(lifecycle.lifecycle.currentTrainingLevel);
    if (input.updatedFields.days > maxWeeklyDays || input.updatedFields.days < MIN_WEEKLY_DAYS) {
      return { status: 'FAILED', reasonCodes: ['WEEKLY_DAYS_OUTSIDE_LEVEL_BOUNDS'] };
    }
  }

  const prescriptionInputSnapshot = buildPrescriptionInputSnapshot({
    answers: syntheticAnswers,
    currentTrainingLevel: lifecycle.lifecycle.currentTrainingLevel,
    source: 'PROGRAM_ADAPTATION',
  });

  const prepared = await prepareWorkoutProgram({
    answers: syntheticAnswers,
    loadTemplate: async (templateId) => {
      const template = await loadWorkoutTemplate(templateId);
      return template ? fromWorkoutTemplateDocument(template) : null;
    },
  });
  if (prepared.status !== 'SUCCESS') return { status: 'FAILED', reasonCodes: prepared.reasonCodes };
  // Safety net, independent of the early guard above: no matter what
  // produced it, a `fixed` plan with an empty `weeklySchedule` must never be
  // sealed — `buildScheduleAuthorityContext`'s `Array.isArray([])` check
  // would accept it as "configured" and leave the user permanently in
  // REST_DAY.
  if ((prepared.plan.scheduleMode ?? 'fixed') === 'fixed') {
    const prescribedFrequency = prepared.plan.prescribedTrainingFrequency
      ?? prepared.plan.prescribedStructuredDays
      ?? prepared.plan.sessions.length;
    const sealedTrainingDayCount = Array.isArray(prepared.plan.weeklySchedule)
      ? prepared.plan.weeklySchedule.filter((day) => day.state === 'TRAINING').length
      : 0;
    if (sealedTrainingDayCount === 0 || sealedTrainingDayCount !== prescribedFrequency) {
      return { status: 'FAILED', reasonCodes: ['ADAPTATION_PRODUCED_EMPTY_WEEKLY_SCHEDULE'] };
    }
  }

  const template = await loadWorkoutTemplate(prepared.templateId);
  if (!template) return { status: 'FAILED', reasonCodes: ['WORKOUT_TEMPLATE_NOT_FOUND'] };

  const activationInput = {
    uid: input.uid,
    questionnaireId: program.questionnaireId,
    questionnaireVersion: program.questionnaireVersion,
    plan: prepared.plan,
    template,
    prescriptionInputSnapshot,
    source: 'program_adaptation' as const,
    lifecycleIdempotencyKey: `adaptation:${input.idempotencyKey}`,
    expectedActiveProgramInstanceId: lifecycle.programInstance.programInstanceId,
    expectedCycleId: lifecycle.cycle.cycleId,
    expectedPrescriptionInputSnapshotId: lifecycle.programInstance.prescriptionInputSnapshot?.snapshotId
      ?? `legacy:${lifecycle.programInstance.programInstanceId}`,
    authorityUpdatedFields: input.updatedFields as Record<string, unknown>,
    clearPendingEvolution: true,
    // No `nextCycle` — adaptation never starts a new TrainingCycle (docs §59).
    eventType: 'PROGRAM_ADAPTED' as const,
    eventPayload: { reason: input.reason },
  };

  const result = await saveAndActivateWorkoutProgram(activationInput);
  await reconcileWorkoutLifecycle({ uid: input.uid }).catch(() => undefined);
  return { status: 'SUCCESS', program: result };
}

export async function adaptWorkoutProgram(input: {
  uid: string;
  updatedFields: Partial<Omit<QuestionnaireAnswers, 'level'>>;
  reason: ProgramAdaptationReason;
  idempotencyKey: string;
}): Promise<ProgramAdaptationResult> {
  try {
    return await adaptWorkoutProgramAttempt(input);
  } catch (firstError) {
    // A concurrent activation/adaptation may invalidate the CAS base after
    // preparation. Rebuild once from the newly authoritative lifecycle and
    // inputs; never reuse a plan/snapshot derived from the stale base.
    try {
      return await adaptWorkoutProgramAttempt(input);
    } catch (retryError) {
      logWorkoutLifecycleEvent({
        name: 'progression_failed', stage: 'ADAPTATION',
        errorCategory: workoutLifecycleErrorCategory(retryError), retryable: true,
      });
      throw firstError;
    }
  }
}
