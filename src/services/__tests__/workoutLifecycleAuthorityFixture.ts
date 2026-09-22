import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import {
  deleteDoc, doc, getDoc, runTransaction, serverTimestamp, setDoc, Timestamp,
} from 'firebase/firestore';

import {
  resetWorkoutLifecycleAuthorityAuthorizerForTests,
  setWorkoutLifecycleAuthorityAuthorizerForTests,
  WORKOUT_LIFECYCLE_AUTHORITY_GRANT_ID,
  type WorkoutLifecycleAuthorityCanonicalContent,
  type WorkoutLifecycleAuthorityRequest,
} from '../../workoutLifecycle/authorityProvider';
import {
  resetInitializeWorkoutProgramV127CallerForTests,
  setInitializeWorkoutProgramV127CallerForTests,
  type InitializeWorkoutProgramV127Request,
  type InitializeWorkoutProgramV127Result,
} from '../../workoutLifecycle/initializeV127Provider';
import {
  cycleIdForOperation, lifecycleEventId, programInstanceIdForOperation, startingLevelFromQuestionnaire,
} from '../../workoutLifecycle/domain';
import { buildPrescriptionInputSnapshot } from '../../workoutLifecycle/prescriptionInputs';
import { createHash } from 'node:crypto';
import { generateWorkoutPrescriptionRouted } from '../../workoutPrescription/generatePrescription';
import { getCanonicalTemplateV127ById } from '../../workoutPrescription/canonicalCatalog';
import { toWorkoutTemplateDocumentBody, type WorkoutTemplateDocument } from '../../workoutPrescription/templateDocument';
import { PRESCRIPTION_VERSIONS_V127, type TemplateId } from '../../workoutPrescription/types';
import { contentIdentityFor } from '../workoutPrograms';
import type { FinalWorkoutPlan, QuestionnaireAnswers } from '../../workoutPrescription/types';

/**
 * Test-only equivalent of `src/services/templateDocumentV127.ts`'s
 * `localWorkoutTemplateDocumentV127` — same pure `toWorkoutTemplateDocumentBody`
 * call, but hashed with `node:crypto` instead of `expo-crypto` (which
 * transitively imports `react-native` — a Flow-syntax module Vite's
 * SSR/Rolldown transform cannot parse, and which this Node-only test
 * fixture never needs: the hash only has to be internally consistent
 * within a single simulated backend call, never byte-identical to what the
 * real device/Cloud Function would compute).
 */
function localTemplateMetadataForTests(templateId: TemplateId): WorkoutTemplateDocument {
  const template = getCanonicalTemplateV127ById(templateId);
  const body = toWorkoutTemplateDocumentBody(template, PRESCRIPTION_VERSIONS_V127.templateLibrary, 'workout_templates_T001_T102_canonical');
  const contentHash = createHash('sha256').update(JSON.stringify(body)).digest('hex');
  return { ...body, contentHash };
}

type CanonicalResponseOverride = (
  request: WorkoutLifecycleAuthorityRequest,
  canonical: WorkoutLifecycleAuthorityCanonicalContent,
) => WorkoutLifecycleAuthorityCanonicalContent | Promise<WorkoutLifecycleAuthorityCanonicalContent>;

let canonicalResponseOverride: CanonicalResponseOverride | null = null;

export function setWorkoutLifecycleCanonicalResponseOverrideForTests(
  override: CanonicalResponseOverride | null,
): void {
  canonicalResponseOverride = override;
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Integration tests exercise the client transaction against real Rules but
 * do not start the Functions runtime. This fixture impersonates only the
 * already-validated backend output by writing the short-lived grant with
 * Rules disabled. Authority validation itself has a separate Functions
 * suite; application tests never gain permission to create a grant through
 * the authenticated client context.
 */
/** Byte-for-byte the same ternary `persistLifecycleActivationV127`
 * (functions/src/workoutLifecycle/authorizeMutation.ts) and
 * `saveAndActivateWorkoutProgram` (src/services/workoutPrograms.ts) both
 * use for `activationReason` — kept in exact sync, not re-derived. */
function activationReasonFor(isNewCycle: boolean, targetProgramSource: unknown): string {
  if (isNewCycle) return 'EVOLUTION_ACTIVATION';
  if (targetProgramSource === 'program_adaptation') return 'PROGRAM_ADAPTATION';
  if (targetProgramSource === 'automatic_progression') return 'V1_AUTOMATIC_PROGRESSION';
  if (targetProgramSource === 'manual_regeneration') return 'MANUAL_REGENERATION';
  return 'AUTOMATIC_RECONCILIATION';
}

/**
 * Fase 16 — impersonates `persistLifecycleActivationV127`
 * (functions/src/workoutLifecycle/authorizeMutation.ts) for a v1.27 ADAPT/
 * ACTIVATE request: performs the SAME full lifecycle-transition write
 * (`programInstances`/`trainingCycles`/`workoutLifecycleState`/
 * `workoutLifecycleEvents`/`workoutProgramState`, plus clearing
 * `pendingEvolutions/current` for ACTIVATE) via the client SDK with Rules
 * disabled, mirroring the real backend transaction field for field, so
 * `saveAndActivateWorkoutProgram`'s "persisted, skip my own transaction"
 * branch gets genuinely exercised by these integration tests — never a
 * shortcut that just always reports "not applicable" for this case (see
 * `installWorkoutLifecycleAuthorityFixture`'s own doc comment for why
 * INITIALIZE stays a "not applicable" passthrough instead: it has its own
 * dedicated real-Functions test suite).
 */
async function persistLifecycleActivationV127ForTests(
  fixtureDb: ReturnType<RulesTestEnvironment['authenticatedContext']>['firestore'] extends (...args: never[]) => infer R ? R : never,
  uid: string,
  request: WorkoutLifecycleAuthorityRequest,
  authoritativeRequest: WorkoutLifecycleAuthorityRequest,
): Promise<{ programId: string; programInstanceId: string }> {
  const targetProgramInstanceId = String(authoritativeRequest.targetProgramInstanceId);
  const targetCycleId = String(authoritativeRequest.targetCycleId);
  const targetContentIdentity = String(authoritativeRequest.targetContentIdentity);
  const targetPrescriptionIdentity = String(authoritativeRequest.targetPrescriptionIdentity);
  const sourceProgramInstanceId = String(request.sourceProgramInstanceId);
  const sourceCycleId = String(request.sourceCycleId);
  const isNewCycle = targetCycleId !== sourceCycleId;
  const eventId = String(authoritativeRequest.eventId);
  const eventType = String(authoritativeRequest.eventType);
  const pendingSnapshot = request.operation === 'ACTIVATE'
    ? await getDoc(doc(fixtureDb, 'users', uid, 'pendingEvolutions', 'current'))
    : null;
  const pendingType = pendingSnapshot?.data()?.type as string | undefined;

  // Mirrors `sealTargetProgram` (functions/src/workoutLifecycle/authorizeMutation.ts)
  // — the real backend seals `workoutPrograms/{contentIdentity}` as a
  // SEPARATE step, before this transition transaction ever runs. Without
  // this, `saveAndActivateWorkoutProgram`'s post-persist read-back
  // (`getDoc(programRef(...))`) would find nothing.
  const sealedRef = doc(fixtureDb, 'users', uid, 'workoutPrograms', targetContentIdentity);
  const sealedSnapshot = await getDoc(sealedRef);
  if (!sealedSnapshot.exists()) {
    const plan = authoritativeRequest.targetPlan as unknown as FinalWorkoutPlan;
    await setDoc(sealedRef, {
      ...plan,
      programId: targetContentIdentity,
      prescriptionId: targetPrescriptionIdentity,
      status: 'active',
      source: authoritativeRequest.targetProgramSource,
      templateVersion: authoritativeRequest.targetTemplateVersion,
      templateSourceVersion: authoritativeRequest.targetTemplateSourceVersion,
      templateContentHash: authoritativeRequest.targetTemplateContentHash,
      questionnaireId: authoritativeRequest.questionnaireId,
      questionnaireVersion: authoritativeRequest.questionnaireVersion,
      createdAt: Timestamp.now(),
      activatedAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
  }
  const activationReason = activationReasonFor(isNewCycle, authoritativeRequest.targetProgramSource);
  const progressionReason = pendingType === 'LEVEL_PROMOTION'
    ? 'EARNED_LEVEL_PROMOTION' : pendingType === 'CYCLE_EVOLUTION' ? 'EARNED_CYCLE_EVOLUTION' : 'EARNED_EVOLUTION';

  const lifecycleRef = doc(fixtureDb, 'users', uid, 'workoutLifecycleState', 'current');
  const instanceRef = doc(fixtureDb, 'users', uid, 'programInstances', targetProgramInstanceId);
  const cycleRef = doc(fixtureDb, 'users', uid, 'trainingCycles', targetCycleId);
  const eventRef = doc(fixtureDb, 'users', uid, 'workoutLifecycleEvents', eventId);
  const stateRef = doc(fixtureDb, 'users', uid, 'workoutProgramState', 'active');
  const currentInstanceRef = doc(fixtureDb, 'users', uid, 'programInstances', sourceProgramInstanceId);
  const currentCycleRef = doc(fixtureDb, 'users', uid, 'trainingCycles', sourceCycleId);
  const pendingRef = doc(fixtureDb, 'users', uid, 'pendingEvolutions', 'current');

  await runTransaction(fixtureDb, async (transaction) => {
    const [instanceSnapshot, lifecycleSnapshot] = await Promise.all([
      transaction.get(instanceRef), transaction.get(lifecycleRef),
    ]);
    if (instanceSnapshot.exists()) return;
    const now = serverTimestamp();
    const previousContentIdentity = lifecycleSnapshot.data()?.activeContentIdentity as string | undefined;
    if (previousContentIdentity && previousContentIdentity !== targetContentIdentity) {
      transaction.update(doc(fixtureDb, 'users', uid, 'workoutPrograms', previousContentIdentity), {
        status: 'superseded', updatedAt: now,
      });
    }
    transaction.update(currentInstanceRef, { supersededAt: now, updatedAt: now });
    transaction.set(instanceRef, {
      programInstanceId: targetProgramInstanceId,
      cycleId: targetCycleId,
      contentIdentity: targetContentIdentity,
      prescriptionIdentity: targetPrescriptionIdentity,
      questionnaireId: authoritativeRequest.questionnaireId,
      prescriptionInputSnapshot: authoritativeRequest.targetPrescriptionInputSnapshot,
      activatedAt: now,
      supersededAt: null,
      previousProgramInstanceId: sourceProgramInstanceId,
      activationReason,
      schemaVersion: 2,
      createdAt: now,
      updatedAt: now,
    });
    if (isNewCycle) {
      transaction.update(currentCycleRef, { status: 'COMPLETED', completedAt: now, updatedAt: now });
      transaction.set(cycleRef, {
        cycleId: targetCycleId,
        level: authoritativeRequest.targetTrainingLevel,
        cycleNumber: authoritativeRequest.targetCycleNumber,
        status: 'ACTIVE',
        origin: 'V2_NATIVE',
        programInstanceId: targetProgramInstanceId,
        previousProgramInstanceId: sourceProgramInstanceId,
        startedAt: now,
        eligibleAt: null,
        completedAt: null,
        completionReason: null,
        progressionReason,
        schemaVersion: 2,
        createdAt: now,
        updatedAt: now,
      });
    } else {
      transaction.update(currentCycleRef, {
        programInstanceId: targetProgramInstanceId, previousProgramInstanceId: sourceProgramInstanceId, updatedAt: now,
      });
    }
    transaction.set(eventRef, {
      eventId,
      type: eventType,
      occurredAt: now,
      cycleId: targetCycleId,
      programInstanceId: targetProgramInstanceId,
      idempotencyKey: authoritativeRequest.idempotencyKey,
      payload: { source: authoritativeRequest.targetProgramSource ?? null, ...(pendingType ? { evolutionType: pendingType } : {}) },
      schemaVersion: 2,
    });
    transaction.set(stateRef, { programId: targetContentIdentity, programInstanceId: targetProgramInstanceId, updatedAt: now });
    transaction.update(lifecycleRef, {
      activeProgramInstanceId: targetProgramInstanceId,
      activeContentIdentity: targetContentIdentity,
      activePrescriptionIdentity: targetPrescriptionIdentity,
      ...(isNewCycle
        ? {
          currentCycleId: targetCycleId,
          currentCycleNumber: authoritativeRequest.targetCycleNumber,
          currentTrainingLevel: authoritativeRequest.targetTrainingLevel,
        }
        : {}),
      updatedAt: now,
    });
  });
  if (request.operation === 'ACTIVATE') {
    await deleteDoc(pendingRef).catch(() => undefined);
  }
  return { programId: targetContentIdentity, programInstanceId: targetProgramInstanceId };
}

/**
 * Fase 16 — impersonates `initializeWorkoutProgramV127Handler`
 * (functions/src/workoutLifecycle/authorizeMutation.ts) for these
 * application-level integration tests: generates the real v1.27 plan with
 * the SAME client-importable, version-synced engine
 * (`generateWorkoutPrescriptionRouted`), computes the SAME deterministic
 * ids, and persists the full lifecycle bootstrap via the client SDK with
 * Rules disabled — mirroring the real backend transaction field for field.
 * A real Functions-runtime call is out of scope for these tests (no
 * Functions emulator here) — `authorizeMutation.integration.test.ts`'s own
 * dedicated Fase 15 suite is what proves the real callable end to end. This
 * exists so the (very common) "seed a brand-new active v1.27 program" setup
 * step these tests already do via `generateAndPersistWorkoutProgram` stops
 * routing through the broken client-transaction path for a real v1.27
 * document — reporting "not applicable" unconditionally (the pre-Fase-16
 * behavior of this fixture) left that setup step hitting the exact
 * expression-ceiling failure this whole cutover exists to eliminate.
 */
async function initializeWorkoutProgramV127ForTests(
  testEnv: RulesTestEnvironment,
  uid: string,
  request: InitializeWorkoutProgramV127Request,
): Promise<InitializeWorkoutProgramV127Result> {
  let outcome: InitializeWorkoutProgramV127Result | undefined;
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const fixtureDb = context.firestore();
    const questionnaireSnapshot = await getDoc(doc(fixtureDb, 'users', uid, 'questionnaires', request.questionnaireId));
    const answers = questionnaireSnapshot.data()?.answers as QuestionnaireAnswers | undefined;
    if (!questionnaireSnapshot.exists() || !answers) {
      throw new Error('workout_lifecycle_v127_initialize_not_applicable');
    }
    const currentTrainingLevel = startingLevelFromQuestionnaire(answers.level) ?? 'INTERMEDIATE';
    const result = generateWorkoutPrescriptionRouted(answers, currentTrainingLevel, {}, 'v1.27');
    if (result.status !== 'SUCCESS') throw new Error('workout_lifecycle_v127_initialize_not_applicable');
    const plan = JSON.parse(JSON.stringify(result.plan)) as typeof result.plan;
    const template = localTemplateMetadataForTests(plan.templateId);
    const contentIdentity = contentIdentityFor({
      questionnaireId: request.questionnaireId,
      questionnaireVersion: request.questionnaireVersion,
      plan,
      template,
    });
    const operationKey = `v2-initial:${contentIdentity}`;
    const targetProgramInstanceId = programInstanceIdForOperation(operationKey);
    const targetCycleId = cycleIdForOperation(operationKey);
    const eventId = lifecycleEventId('PROGRAM_STARTED', operationKey);

    const lifecycleRef = doc(fixtureDb, 'users', uid, 'workoutLifecycleState', 'current');
    const legacyStateRef = doc(fixtureDb, 'users', uid, 'workoutProgramState', 'active');
    const [lifecycleSnapshot, legacyStateSnapshot] = await Promise.all([getDoc(lifecycleRef), getDoc(legacyStateRef)]);
    if (lifecycleSnapshot.exists()) {
      const lifecycleData = lifecycleSnapshot.data();
      if (lifecycleData.activeContentIdentity === contentIdentity && lifecycleData.activeProgramInstanceId === targetProgramInstanceId) {
        outcome = { status: 'SUCCESS', programId: contentIdentity, programInstanceId: targetProgramInstanceId };
        return;
      }
      throw new Error('workout_lifecycle_v127_initialize_not_applicable');
    }
    if (legacyStateSnapshot.exists()) throw new Error('workout_lifecycle_v127_initialize_not_applicable');

    const prescriptionInputSnapshot = buildPrescriptionInputSnapshot({
      answers, currentTrainingLevel, source: 'QUESTIONNAIRE_BASELINE',
    });
    const now = Timestamp.now();
    await setDoc(doc(fixtureDb, 'users', uid, 'workoutPrograms', contentIdentity), {
      ...plan,
      programId: contentIdentity,
      prescriptionId: plan.planId,
      status: 'active',
      source: request.source ?? 'onboarding',
      templateVersion: template.version,
      templateSourceVersion: template.sourceVersion,
      templateContentHash: template.contentHash,
      questionnaireId: request.questionnaireId,
      questionnaireVersion: request.questionnaireVersion,
      createdAt: now,
      activatedAt: now,
      updatedAt: now,
    });
    await runTransaction(fixtureDb, async (transaction) => {
      const nowTs = serverTimestamp();
      transaction.set(doc(fixtureDb, 'users', uid, 'programInstances', targetProgramInstanceId), {
        programInstanceId: targetProgramInstanceId,
        cycleId: targetCycleId,
        contentIdentity,
        prescriptionIdentity: plan.planId,
        questionnaireId: request.questionnaireId,
        prescriptionInputSnapshot,
        activatedAt: nowTs,
        supersededAt: null,
        previousProgramInstanceId: null,
        activationReason: 'INITIAL_PROGRAM',
        schemaVersion: 2,
        createdAt: nowTs,
        updatedAt: nowTs,
      });
      transaction.set(doc(fixtureDb, 'users', uid, 'trainingCycles', targetCycleId), {
        cycleId: targetCycleId,
        level: currentTrainingLevel,
        cycleNumber: 1,
        status: 'ACTIVE',
        origin: 'V2_NATIVE',
        programInstanceId: targetProgramInstanceId,
        previousProgramInstanceId: null,
        startedAt: nowTs,
        eligibleAt: null,
        completedAt: null,
        completionReason: null,
        progressionReason: 'INITIAL_PRESCRIPTION',
        schemaVersion: 2,
        createdAt: nowTs,
        updatedAt: nowTs,
      });
      transaction.set(lifecycleRef, {
        startingLevel: currentTrainingLevel,
        currentTrainingLevel,
        currentCycleId: targetCycleId,
        currentCycleNumber: 1,
        activeProgramInstanceId: targetProgramInstanceId,
        activeContentIdentity: contentIdentity,
        activePrescriptionIdentity: plan.planId,
        initializationOrigin: 'V2_NATIVE',
        historyCompleteFrom: nowTs,
        schemaVersion: 2,
        createdAt: nowTs,
        updatedAt: nowTs,
      });
      transaction.set(doc(fixtureDb, 'users', uid, 'workoutLifecycleEvents', eventId), {
        eventId,
        type: 'PROGRAM_STARTED',
        occurredAt: nowTs,
        cycleId: targetCycleId,
        programInstanceId: targetProgramInstanceId,
        idempotencyKey: operationKey,
        payload: { source: request.source ?? 'onboarding' },
        schemaVersion: 2,
      });
      transaction.set(legacyStateRef, {
        programId: contentIdentity, programInstanceId: targetProgramInstanceId, updatedAt: nowTs,
      });
    });
    outcome = { status: 'SUCCESS', programId: contentIdentity, programInstanceId: targetProgramInstanceId };
  });
  return outcome!;
}

export function installWorkoutLifecycleAuthorityFixture(
  testEnv: RulesTestEnvironment,
  uid: string,
): void {
  setInitializeWorkoutProgramV127CallerForTests((request) => initializeWorkoutProgramV127ForTests(testEnv, uid, request));
  setWorkoutLifecycleAuthorityAuthorizerForTests(async (request: WorkoutLifecycleAuthorityRequest) => {
    const expiresAtMs = Date.now() + 60_000;
    let responseCanonical: WorkoutLifecycleAuthorityCanonicalContent | undefined;
    let persistedResult: { programId: string; programInstanceId: string } | undefined;
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const fixtureDb = context.firestore();
      const activeState = await getDoc(doc(fixtureDb, 'users', uid, 'workoutProgramState', 'active'));
      const baselineContentIdentity = activeState.data()?.programId as string | undefined;
      const baselineProgram = request.operation === 'MIGRATE' && baselineContentIdentity
        ? await getDoc(doc(fixtureDb, 'users', uid, 'workoutPrograms', baselineContentIdentity))
        : null;
      const canonicalOperation = ['INITIALIZE', 'MIGRATE', 'ADAPT', 'PREPARE'].includes(request.operation);
      if (canonicalOperation) {
        const submittedPlan = request.targetPlan ?? {};
        let targetPlan = {
          ...submittedPlan,
          planId: typeof submittedPlan.planId === 'string'
            ? submittedPlan.planId : String(request.targetPrescriptionIdentity),
          templateId: typeof submittedPlan.templateId === 'string' ? submittedPlan.templateId : 'T001',
        } as unknown as FinalWorkoutPlan;
        // Fase 16 — ADAPT never re-selects a template library: the real
        // backend's `authoritativeGenerationVersionForActiveProgram`
        // ALWAYS preserves the currently-active program's own version,
        // completely ignoring whatever version the client's local
        // candidate happened to compute (`saveAndActivateWorkoutProgram`'s
        // v2-only `prepareWorkoutProgram` local preview is never version-
        // routed — see that call site's own comment). Mirrored here: if an
        // active v1.27 program already exists, the synthesized response
        // preserves ITS version fields, exactly like the real backend
        // would — never the client's (possibly v2-shaped) submitted plan's.
        if (request.operation === 'ADAPT' && baselineContentIdentity) {
          const activeProgram = await getDoc(doc(fixtureDb, 'users', uid, 'workoutPrograms', baselineContentIdentity));
          const activeVersions = activeProgram.data()?.versions;
          if (activeVersions) {
            targetPlan = { ...targetPlan, versions: activeVersions };
          }
        }
        const templateSnapshot = await getDoc(doc(fixtureDb, 'workoutTemplates', targetPlan.templateId));
        const template = templateSnapshot.data();
        responseCanonical = {
          targetPlan,
          targetContentIdentity: String(request.targetContentIdentity),
          targetPrescriptionIdentity: targetPlan.planId,
          targetTemplateVersion: request.targetTemplateVersion ?? Number(template?.version),
          targetTemplateSourceVersion: request.targetTemplateSourceVersion ?? String(template?.sourceVersion),
          targetTemplateContentHash: request.targetTemplateContentHash ?? String(template?.contentHash),
        };
        if (canonicalResponseOverride) {
          responseCanonical = await canonicalResponseOverride(request, responseCanonical);
        }
      }
      let authoritativeRequest: WorkoutLifecycleAuthorityRequest = responseCanonical
        ? {
          ...request,
          targetPlan: responseCanonical.targetPlan as unknown as Record<string, unknown>,
          targetContentIdentity: responseCanonical.targetContentIdentity,
          targetPrescriptionIdentity: responseCanonical.targetPrescriptionIdentity,
          targetTemplateVersion: responseCanonical.targetTemplateVersion,
          targetTemplateSourceVersion: responseCanonical.targetTemplateSourceVersion,
          targetTemplateContentHash: responseCanonical.targetTemplateContentHash,
        }
        : request;
      if (responseCanonical && (request.operation === 'INITIALIZE' || request.operation === 'MIGRATE')) {
        const operationKey = request.idempotencyKey?.startsWith('activation:')
          ? request.idempotencyKey
          : `${request.operation === 'MIGRATE' ? 'v1-baseline' : 'v2-initial'}:${responseCanonical.targetContentIdentity}`;
        authoritativeRequest = {
          ...authoritativeRequest,
          idempotencyKey: operationKey,
          targetProgramInstanceId: `wpi_${stableHash(operationKey)}`,
          targetCycleId: `cyc_${stableHash(operationKey)}`,
          eventId: `wle_${stableHash(`PROGRAM_STARTED:${operationKey}`)}`,
        };
      } else if (responseCanonical && request.operation === 'ADAPT'
        && !request.idempotencyKey?.startsWith('activation:')) {
        const operationKey = `content:${request.sourceProgramInstanceId}:${responseCanonical.targetContentIdentity}`;
        authoritativeRequest = {
          ...authoritativeRequest,
          idempotencyKey: operationKey,
          targetProgramInstanceId: `wpi_${stableHash(operationKey)}`,
          eventId: `wle_${stableHash(`PROGRAM_ADAPTED:${operationKey}`)}`,
        };
      }
      // Fase 16 — v1.27 ADAPT/ACTIVATE: mirror the real backend's full
      // Admin-SDK persist instead of a grant (see
      // `persistLifecycleActivationV127ForTests`'s own doc comment). The
      // effective plan is `responseCanonical.targetPlan` for ADAPT (backend-
      // recomputed) or the request's own `targetPlan` for ACTIVATE (never
      // recomputed server-side — cross-checked byte-for-byte against the
      // sealed pending instead, exactly like the real backend).
      const effectivePlanForVersionCheck = responseCanonical?.targetPlan
        ?? (request.targetPlan as unknown as { versions?: { templateLibrary?: unknown } } | undefined);
      const isV127Transition = (request.operation === 'ADAPT' || request.operation === 'ACTIVATE')
        && effectivePlanForVersionCheck?.versions?.templateLibrary === '1.27.0';
      if (isV127Transition) {
        persistedResult = await persistLifecycleActivationV127ForTests(fixtureDb, uid, request, authoritativeRequest);
        return;
      }
      // This fixture normally impersonates only the validated grant; the
      // client save transaction creates content in these Rules tests. Direct
      // legacy MIGRATE is the one path that relies on the callable's Admin
      // seal before it writes lifecycle pointers, so materialize that seal.
      if (responseCanonical && request.operation === 'MIGRATE') {
        const sealedRef = doc(
          fixtureDb, 'users', uid, 'workoutPrograms', responseCanonical.targetContentIdentity,
        );
        const sealed = await getDoc(sealedRef);
        if (!sealed.exists()) {
          await setDoc(sealedRef, {
            ...responseCanonical.targetPlan,
            programId: responseCanonical.targetContentIdentity,
            prescriptionId: responseCanonical.targetPrescriptionIdentity,
            status: 'active',
            source: authoritativeRequest.targetProgramSource,
            templateVersion: responseCanonical.targetTemplateVersion,
            templateSourceVersion: responseCanonical.targetTemplateSourceVersion,
            templateContentHash: responseCanonical.targetTemplateContentHash,
            questionnaireId: authoritativeRequest.questionnaireId,
            questionnaireVersion: authoritativeRequest.questionnaireVersion,
            createdAt: Timestamp.now(),
            activatedAt: Timestamp.now(),
            updatedAt: Timestamp.now(),
          });
        }
      }
      await setDoc(doc(
        fixtureDb,
        'users', uid, 'workoutLifecycleAuthorityGrants', WORKOUT_LIFECYCLE_AUTHORITY_GRANT_ID,
      ), {
        ...authoritativeRequest,
        targetTrainingLevel: authoritativeRequest.targetTrainingLevel
          ?? ({ beginner: 'BEGINNER', intermediate: 'INTERMEDIATE', advanced: 'ADVANCED' }[
            String(authoritativeRequest.targetPrescriptionInputSnapshot?.inputs
              && (authoritativeRequest.targetPrescriptionInputSnapshot.inputs as Record<string, unknown>).level)
          ] ?? 'BEGINNER'),
        targetCycleNumber: authoritativeRequest.targetCycleNumber ?? 1,
        uid,
        schemaVersion: 1,
        issuedAt: Timestamp.now(),
        expiresAt: Timestamp.fromMillis(expiresAtMs),
        createdAt: Timestamp.now(),
        ...(authoritativeRequest.earnedFact ? { authoritativeEarnedFact: authoritativeRequest.earnedFact } : {}),
        ...(request.operation === 'MIGRATE' && baselineContentIdentity && baselineProgram?.exists()
          ? {
            baselineProgramInstanceId: `wpi_${stableHash(`v1-baseline:${baselineContentIdentity}`)}`,
            baselineContentIdentity,
            baselinePrescriptionIdentity: baselineProgram.data().prescriptionId,
          }
          : {}),
      });
    });
    if (persistedResult) return { persisted: persistedResult };
    return {
      grantId: WORKOUT_LIFECYCLE_AUTHORITY_GRANT_ID,
      expiresAtMs,
      ...(responseCanonical ? { canonical: responseCanonical } : {}),
    };
  });
}

export function resetWorkoutLifecycleAuthorityFixture(): void {
  canonicalResponseOverride = null;
  resetWorkoutLifecycleAuthorityAuthorizerForTests();
  resetInitializeWorkoutProgramV127CallerForTests();
}
