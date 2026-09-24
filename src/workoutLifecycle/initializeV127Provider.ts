export const INITIALIZE_WORKOUT_PROGRAM_V127_CALLABLE = 'initializeWorkoutProgramV127';

export interface InitializeWorkoutProgramV127Request {
  questionnaireId: string;
  questionnaireVersion: number;
  /** Defaults to 'onboarding' server-side when omitted. Purely an audit/
   * analytics label (never used for any authorization decision) — the
   * same `WorkoutProgramSource` enum every other write path accepts. */
  source?: 'onboarding' | 'manual_regeneration' | 'automatic_progression'
    | 'automatic_reconciliation' | 'evolution_activation' | 'program_adaptation';
}

export interface InitializeWorkoutProgramV127Result {
  status: 'SUCCESS';
  programId: string;
  programInstanceId: string;
}

export type InitializeWorkoutProgramV127Caller = (
  request: InitializeWorkoutProgramV127Request,
) => Promise<InitializeWorkoutProgramV127Result>;

const cloudCaller: InitializeWorkoutProgramV127Caller = async (request) => {
  const [{ httpsCallable }, { functions }] = await Promise.all([
    import('firebase/functions'),
    import('../lib/firebaseFunctions'),
  ]);
  const callable = httpsCallable<
    InitializeWorkoutProgramV127Request,
    InitializeWorkoutProgramV127Result
  >(functions, INITIALIZE_WORKOUT_PROGRAM_V127_CALLABLE);
  return (await callable(request)).data;
};

let caller: InitializeWorkoutProgramV127Caller = cloudCaller;

export async function initializeWorkoutProgramV127(
  request: InitializeWorkoutProgramV127Request,
): Promise<InitializeWorkoutProgramV127Result> {
  return caller(request);
}

/** True for the specific, expected "this endpoint does not apply" outcome
 * (`initializeWorkoutProgramV127Handler`'s own doc comment: existing V1
 * baseline, existing V2/v1.27 lifecycle, or a non-v1.27 active generation
 * version) — callers fall back to the existing grant-based flow for this
 * one error, never for any other failure. */
export function isWorkoutLifecycleV127InitializeNotApplicable(error: unknown): boolean {
  const message = (error as { message?: unknown; details?: unknown })?.message;
  return typeof message === 'string' && message.includes('workout_lifecycle_v127_initialize_not_applicable');
}

/** Test-only dependency injection; production always uses the App-Check enforced callable. */
export function setInitializeWorkoutProgramV127CallerForTests(value: InitializeWorkoutProgramV127Caller): void {
  caller = value;
}

export function resetInitializeWorkoutProgramV127CallerForTests(): void {
  caller = cloudCaller;
}
