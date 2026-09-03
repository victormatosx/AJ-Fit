import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, Timestamp } from 'firebase/firestore';

import {
  resetWorkoutLifecycleAuthorityAuthorizerForTests,
  setWorkoutLifecycleAuthorityAuthorizerForTests,
  WORKOUT_LIFECYCLE_AUTHORITY_GRANT_ID,
  type WorkoutLifecycleAuthorityCanonicalContent,
  type WorkoutLifecycleAuthorityRequest,
} from '../../workoutLifecycle/authorityProvider';
import type { FinalWorkoutPlan } from '../../workoutPrescription/types';

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
export function installWorkoutLifecycleAuthorityFixture(
  testEnv: RulesTestEnvironment,
  uid: string,
): void {
  setWorkoutLifecycleAuthorityAuthorizerForTests(async (request: WorkoutLifecycleAuthorityRequest) => {
    const expiresAtMs = Date.now() + 60_000;
    let responseCanonical: WorkoutLifecycleAuthorityCanonicalContent | undefined;
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
        const targetPlan = {
          ...submittedPlan,
          planId: typeof submittedPlan.planId === 'string'
            ? submittedPlan.planId : String(request.targetPrescriptionIdentity),
          templateId: typeof submittedPlan.templateId === 'string' ? submittedPlan.templateId : 'T001',
        } as unknown as FinalWorkoutPlan;
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
}
