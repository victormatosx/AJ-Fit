import type { FinalWorkoutPlan } from '../workoutPrescription/types';

export const WORKOUT_LIFECYCLE_AUTHORITY_CALLABLE = 'authorizeWorkoutLifecycleMutation';
export const WORKOUT_LIFECYCLE_AUTHORITY_GRANT_ID = 'current';

export type WorkoutLifecycleAuthorityOperation =
  | 'INITIALIZE' | 'MIGRATE' | 'RECOVER' | 'EARN' | 'PREPARE' | 'DEFER'
  | 'ACTIVATE' | 'ADAPT' | 'FINISH_EXECUTION' | 'COMPLETE_SCHEDULE' | 'RESOLVE_MISSED_SESSION';

export interface WorkoutLifecycleAuthorityRequest {
  operation: WorkoutLifecycleAuthorityOperation;
  sourceProgramInstanceId?: string;
  sourceCycleId?: string;
  sourcePrescriptionInputSnapshotId?: string;
  targetProgramInstanceId?: string;
  targetCycleId?: string;
  targetContentIdentity?: string;
  targetPrescriptionIdentity?: string;
  targetTrainingLevel?: string;
  targetCycleNumber?: number;
  questionnaireId?: string;
  questionnaireVersion?: number;
  targetProgramSource?: string;
  targetTemplateVersion?: number;
  targetTemplateSourceVersion?: string;
  targetTemplateContentHash?: string;
  pendingEvolutionId?: string;
  eventId?: string;
  eventType?: string;
  idempotencyKey?: string;
  executionId?: string;
  scheduledLocalDate?: string;
  sessionIndex?: number;
  decision?: 'CONTINUE_SEQUENCE' | 'FOLLOW_SCHEDULE';
  expectedMissedSessionIndex?: number;
  expectedCalendarSessionIndex?: number;
  expectedMissedScheduledDate?: string;
  targetPlan?: Record<string, unknown>;
  targetPrescriptionInputSnapshot?: Record<string, unknown>;
  updatedFields?: Record<string, unknown>;
  earnedFact?: Record<string, unknown>;
}

/**
 * Present whenever the backend computed the canonical prescription itself
 * (INITIALIZE/MIGRATE/ADAPT/PREPARE — docs/workout-lifecycle/v2/decisions/
 * ADR-016_BACKEND_AUTHORITATIVE_PRESCRIPTION.md). In the common case this is
 * identical to whatever this client itself computed (same deterministic
 * engine, same catalogs); it only diverges if the live exercise/template
 * catalog changed between this client's read and the backend call. Every
 * caller that persists newly generated content must require and consume this
 * complete object; the local candidate is preview/intent only after the
 * callable resolves.
 */
export interface WorkoutLifecycleAuthorityCanonicalContent {
  targetPlan: FinalWorkoutPlan;
  targetContentIdentity: string;
  targetPrescriptionIdentity: string;
  targetTemplateVersion: number;
  targetTemplateSourceVersion: string;
  targetTemplateContentHash: string;
}

export interface WorkoutLifecycleAuthorityResult {
  grantId?: string;
  expiresAtMs?: number;
  canonical?: WorkoutLifecycleAuthorityCanonicalContent;
  /**
   * Fase 16 — present exclusively for v1.27 ADAPT/ACTIVATE
   * (`authorizeWorkoutLifecycleMutationHandler`'s own doc comment): the
   * backend already persisted the entire lifecycle transition via Admin SDK
   * — no grant is issued in this case, `grantId`/`expiresAtMs` are absent,
   * and the caller must skip its own Firestore transaction entirely.
   */
  persisted?: { programId: string; programInstanceId: string };
}

export type WorkoutLifecycleAuthorityAuthorizer = (
  request: WorkoutLifecycleAuthorityRequest,
) => Promise<WorkoutLifecycleAuthorityResult>;

const cloudAuthorizer: WorkoutLifecycleAuthorityAuthorizer = async (request) => {
  const [{ httpsCallable }, { functions }] = await Promise.all([
    import('firebase/functions'),
    import('../lib/firebaseFunctions'),
  ]);
  const callable = httpsCallable<
    WorkoutLifecycleAuthorityRequest,
    WorkoutLifecycleAuthorityResult
  >(functions, WORKOUT_LIFECYCLE_AUTHORITY_CALLABLE);
  return (await callable(request)).data;
};

let authorizer: WorkoutLifecycleAuthorityAuthorizer = cloudAuthorizer;

export async function authorizeWorkoutLifecycleMutation(
  request: WorkoutLifecycleAuthorityRequest,
): Promise<WorkoutLifecycleAuthorityResult> {
  const result = await authorizer(request);
  if (result.persisted) {
    if (typeof result.persisted.programId !== 'string' || typeof result.persisted.programInstanceId !== 'string') {
      throw new Error('WORKOUT_LIFECYCLE_PERSISTED_RESPONSE_INVALID');
    }
    return result;
  }
  if (result.grantId !== WORKOUT_LIFECYCLE_AUTHORITY_GRANT_ID || !result.expiresAtMs || result.expiresAtMs <= Date.now()) {
    throw new Error('WORKOUT_LIFECYCLE_AUTHORITY_GRANT_INVALID');
  }
  if (!result.canonical) return result;
  const canonical = result.canonical;
  if (
    typeof canonical.targetContentIdentity !== 'string'
    || typeof canonical.targetPrescriptionIdentity !== 'string'
    || typeof canonical.targetTemplateVersion !== 'number'
    || typeof canonical.targetTemplateSourceVersion !== 'string'
    || typeof canonical.targetTemplateContentHash !== 'string'
    || typeof canonical.targetPlan !== 'object'
    || canonical.targetPlan === null
  ) {
    throw new Error('WORKOUT_LIFECYCLE_CANONICAL_RESPONSE_INVALID');
  }
  // Callable payloads are JSON data in production. Clone here as well so a
  // test authorizer (or any future in-process transport) cannot make the
  // canonical response alias the pre-authorization candidate object.
  return {
    ...result,
    canonical: JSON.parse(JSON.stringify(canonical)) as WorkoutLifecycleAuthorityCanonicalContent,
  };
}

export function requireWorkoutLifecycleCanonical(
  result: WorkoutLifecycleAuthorityResult,
  operation: 'INITIALIZE' | 'MIGRATE' | 'ADAPT' | 'PREPARE',
): WorkoutLifecycleAuthorityCanonicalContent {
  if (!result.canonical) {
    throw new Error(`WORKOUT_LIFECYCLE_CANONICAL_RESPONSE_MISSING:${operation}`);
  }
  return result.canonical;
}

/** Test-only dependency injection; production always uses the App-Check enforced callable. */
export function setWorkoutLifecycleAuthorityAuthorizerForTests(
  value: WorkoutLifecycleAuthorityAuthorizer,
): void {
  authorizer = value;
}

export function resetWorkoutLifecycleAuthorityAuthorizerForTests(): void {
  authorizer = cloudAuthorizer;
}
