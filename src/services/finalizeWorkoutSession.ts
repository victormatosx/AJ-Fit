import { logInfo } from '../lib/logger';
import type { WorkoutCompletion } from '../workoutExecution/types';

export type WorkoutFinalizationMode = 'NORMAL' | 'EARLY';

export interface FinalizeWorkoutSessionInput {
  executionId: string;
  /** Omitted callers retain the pre-existing NORMAL behavior. */
  mode?: WorkoutFinalizationMode;
  cardio?: { actualDurationSeconds: number };
}

export interface FinalizeWorkoutSessionResult {
  status: 'COMPLETED';
  executionStatus: 'COMPLETED' | 'PARTIALLY_COMPLETED';
  cardioStatus: 'NOT_APPLICABLE' | 'COMPLETED' | 'SKIPPED';
  scheduleStatus: 'COMPLETED';
  completion: WorkoutCompletion;
}

export type FinalizeWorkoutSessionTransport = (
  input: FinalizeWorkoutSessionInput,
) => Promise<FinalizeWorkoutSessionResult>;

export const FINALIZE_WORKOUT_SESSION_CALLABLE = 'finalizeWorkoutSession';

const cloudTransport: FinalizeWorkoutSessionTransport = async (input) => {
  const [{ httpsCallable }, { functions }] = await Promise.all([
    import('firebase/functions'),
    import('../lib/firebaseFunctions'),
  ]);
  return (await httpsCallable<FinalizeWorkoutSessionInput, FinalizeWorkoutSessionResult>(
    functions,
    FINALIZE_WORKOUT_SESSION_CALLABLE,
  )(input)).data;
};

let transport = cloudTransport;

export function setFinalizeWorkoutSessionTransportForTests(value: FinalizeWorkoutSessionTransport): void {
  transport = value;
}

export function resetFinalizeWorkoutSessionTransportForTests(): void {
  transport = cloudTransport;
}

/** One device round trip; uid, terminal status and Schedule target are server-derived. */
export async function finalizeWorkoutSession(
  input: FinalizeWorkoutSessionInput,
): Promise<FinalizeWorkoutSessionResult> {
  const startedAtMs = Date.now();
  logInfo('workout_performance', 'finalize_callable_start', { timestampMs: startedAtMs });
  try {
    const result = await transport(input);
    logInfo('workout_performance', 'finalize_callable_end', {
      timestampMs: Date.now(), durationMs: Date.now() - startedAtMs, success: true,
    });
    return result;
  } catch (error) {
    logInfo('workout_performance', 'finalize_callable_end', {
      timestampMs: Date.now(), durationMs: Date.now() - startedAtMs, success: false,
    });
    throw error;
  }
}

export function workoutFinalizationFailureStage(error: unknown): 'EXECUTION' | 'SCHEDULE' {
  if (typeof error !== 'object' || error === null) return 'EXECUTION';
  const details = 'details' in error ? (error as { details?: unknown }).details : null;
  return typeof details === 'object' && details !== null
    && 'stage' in details && (details as { stage?: unknown }).stage === 'SCHEDULE'
    ? 'SCHEDULE' : 'EXECUTION';
}
