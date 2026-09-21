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
  grantId: string;
  expiresAtMs: number;
  canonical?: WorkoutLifecycleAuthorityCanonicalContent;
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
  if (result.grantId !== WORKOUT_LIFECYCLE_AUTHORITY_GRANT_ID || result.expiresAtMs <= Date.now()) {
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

// ─── Fase 2.8 — server-side INITIALIZE install ─────────────────────────────
// A narrow, separate callable from the grant-issuing one above: for a
// brand-new account's first program only, the server performs the entire
// Admin SDK write itself (see `functions/src/workoutLifecycle/
// installActiveWorkoutProgram.ts`) instead of issuing a grant for this
// client to redeem via its own `runTransaction` — that transaction reliably
// exceeds the Firestore rules engine's expression-evaluation ceiling for
// this exact real flow (Fase 2.6/2.7 audits).

export const INSTALL_ACTIVE_WORKOUT_PROGRAM_CALLABLE = 'installActiveWorkoutProgram';

export interface InstallActiveWorkoutProgramRequest {
  questionnaireId: string;
  questionnaireVersion: number;
  targetPrescriptionInputSnapshot: Record<string, unknown>;
  source: 'onboarding' | 'automatic_reconciliation';
  /**
   * This client's own locally-generated candidate plan/template — a
   * preview/intent only, exactly like `targetPlan` on
   * `WorkoutLifecycleAuthorityRequest` above. The real server NEVER reads
   * either field: it generates the canonical plan itself from the
   * authoritative questionnaire (see `installActiveWorkoutProgram.ts`'s doc
   * comment). Present ONLY so integration-test fixtures — which fake this
   * callable's response without running the real Functions runtime, the
   * same way `workoutLifecycleAuthorityFixture.ts` already does for
   * `authorizeWorkoutLifecycleMutation` — have something to echo back as
   * the "canonical" result.
   */
  previewPlan?: Record<string, unknown>;
  previewTemplate?: { id: string; version: number; sourceVersion: string; contentHash: string };
  /**
   * This client's own locally-computed candidate content identity
   * (`programIdentity`/`contentIdentityFor` — `saveAndActivateWorkoutProgram`'s
   * `candidateProgramId`). Like `previewPlan`/`previewTemplate`, the real
   * server never reads this: it derives the identity itself from the
   * canonical plan it generates. Present only so fixtures can prove a
   * "catalog race" (backend regenerates different content than this
   * client's candidate) the same way the existing `authorizeWorkoutLifecycleMutation`
   * fixture already does via `setWorkoutLifecycleCanonicalResponseOverrideForTests`.
   */
  previewContentIdentity?: string;
}

export interface InstallActiveWorkoutProgramResult {
  status: 'installed' | 'already_active';
  programId: string;
  programInstanceId: string;
}

export type InstallActiveWorkoutProgramInvoker = (
  request: InstallActiveWorkoutProgramRequest,
) => Promise<InstallActiveWorkoutProgramResult>;

const cloudInstallActiveWorkoutProgram: InstallActiveWorkoutProgramInvoker = async (request) => {
  const [{ httpsCallable }, { functions }] = await Promise.all([
    import('firebase/functions'),
    import('../lib/firebaseFunctions'),
  ]);
  const callable = httpsCallable<InstallActiveWorkoutProgramRequest, InstallActiveWorkoutProgramResult>(
    functions, INSTALL_ACTIVE_WORKOUT_PROGRAM_CALLABLE,
  );
  return (await callable(request)).data;
};

let installActiveWorkoutProgramInvoker: InstallActiveWorkoutProgramInvoker = cloudInstallActiveWorkoutProgram;

export async function installActiveWorkoutProgram(
  request: InstallActiveWorkoutProgramRequest,
): Promise<InstallActiveWorkoutProgramResult> {
  const result = await installActiveWorkoutProgramInvoker(request);
  if (
    (result.status !== 'installed' && result.status !== 'already_active')
    || typeof result.programId !== 'string'
    || typeof result.programInstanceId !== 'string'
  ) {
    throw new Error('WORKOUT_LIFECYCLE_INSTALL_RESPONSE_INVALID');
  }
  return result;
}

/** Test-only dependency injection; production always uses the App-Check enforced callable. */
export function setInstallActiveWorkoutProgramInvokerForTests(value: InstallActiveWorkoutProgramInvoker): void {
  installActiveWorkoutProgramInvoker = value;
}

export function resetInstallActiveWorkoutProgramInvokerForTests(): void {
  installActiveWorkoutProgramInvoker = cloudInstallActiveWorkoutProgram;
}
