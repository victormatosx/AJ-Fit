import type { WorkoutFinalizationProgressStage } from './finalizationProgress';

export type WorkoutFinalizationInfrastructurePhase =
  | 'ATTEMPT_ID'
  | 'LISTENER_SETUP'
  | 'LISTENER_CALLBACK'
  | 'LISTENER_CLEANUP'
  | 'VISUAL_PROGRESS';

export interface WorkoutFinalizationProgressAttempt {
  attemptId: string | null;
  reportCheckpoint: (stage: WorkoutFinalizationProgressStage) => void;
  dispose: () => void;
}

interface CreateProgressAttemptInput {
  createAttemptId: () => string;
  subscribe?: (
    attemptId: string,
    onStage: (stage: WorkoutFinalizationProgressStage) => void,
    onError: (error: unknown) => void,
  ) => () => void;
  onStage: (stage: WorkoutFinalizationProgressStage) => void;
  onInfrastructureError?: (phase: WorkoutFinalizationInfrastructurePhase, error: unknown) => void;
}

function reportInfrastructureError(
  reporter: CreateProgressAttemptInput['onInfrastructureError'],
  phase: WorkoutFinalizationInfrastructurePhase,
  error: unknown,
): void {
  try {
    reporter?.(phase, error);
  } catch {
    // Diagnostics are part of the non-authoritative progress infrastructure.
  }
}

/**
 * Creates the optional progress sidecar runtime. Every operation in this
 * object is fail-closed for progress and fail-open for workout finalization.
 */
export function createWorkoutFinalizationProgressAttempt(
  input: CreateProgressAttemptInput,
): WorkoutFinalizationProgressAttempt {
  let active = true;
  let unsubscribe: (() => void) | null = null;
  let attemptId: string | null = null;

  const reportCheckpoint = (stage: WorkoutFinalizationProgressStage): void => {
    if (!active) return;
    try {
      input.onStage(stage);
    } catch (error) {
      reportInfrastructureError(input.onInfrastructureError, 'VISUAL_PROGRESS', error);
    }
  };

  try {
    attemptId = input.createAttemptId();
  } catch (error) {
    reportInfrastructureError(input.onInfrastructureError, 'ATTEMPT_ID', error);
  }

  if (attemptId && input.subscribe) {
    try {
      unsubscribe = input.subscribe(
        attemptId,
        (stage) => {
          if (!active) return;
          try {
            reportCheckpoint(stage);
          } catch (error) {
            reportInfrastructureError(input.onInfrastructureError, 'LISTENER_CALLBACK', error);
          }
        },
        (error) => reportInfrastructureError(input.onInfrastructureError, 'LISTENER_CALLBACK', error),
      );
    } catch (error) {
      reportInfrastructureError(input.onInfrastructureError, 'LISTENER_SETUP', error);
    }
  }

  return {
    attemptId,
    reportCheckpoint,
    dispose: () => {
      if (!active) return;
      active = false;
      try {
        unsubscribe?.();
      } catch (error) {
        reportInfrastructureError(input.onInfrastructureError, 'LISTENER_CLEANUP', error);
      }
      unsubscribe = null;
    },
  };
}

export async function runWorkoutFinalizationWithBestEffortProgress<T>(input: {
  createProgressAttempt: () => WorkoutFinalizationProgressAttempt;
  runAuthoritative: (
    attemptId: string | null,
    reportCheckpoint: (stage: WorkoutFinalizationProgressStage) => void,
  ) => Promise<T>;
  isAuthoritativelyCommitted: (result: T) => boolean;
  onAttemptStarted?: (attempt: WorkoutFinalizationProgressAttempt) => void;
  onAttemptFinished?: (attempt: WorkoutFinalizationProgressAttempt) => void;
  onInfrastructureError?: (phase: WorkoutFinalizationInfrastructurePhase, error: unknown) => void;
}): Promise<T> {
  let attempt: WorkoutFinalizationProgressAttempt;
  try {
    attempt = input.createProgressAttempt();
  } catch (error) {
    // Defensive boundary for callers constructing the best-effort runtime.
    reportInfrastructureError(input.onInfrastructureError, 'LISTENER_SETUP', error);
    attempt = {
      attemptId: null,
      reportCheckpoint: () => undefined,
      dispose: () => undefined,
    };
  }

  try {
    try {
      input.onAttemptStarted?.(attempt);
    } catch (error) {
      reportInfrastructureError(input.onInfrastructureError, 'LISTENER_SETUP', error);
    }
    const reportCheckpoint = (stage: WorkoutFinalizationProgressStage): void => {
      try {
        attempt.reportCheckpoint(stage);
      } catch (error) {
        reportInfrastructureError(input.onInfrastructureError, 'VISUAL_PROGRESS', error);
      }
    };
    const result = await input.runAuthoritative(attempt.attemptId, reportCheckpoint);
    let committed = false;
    try {
      committed = input.isAuthoritativelyCommitted(result);
    } catch (error) {
      reportInfrastructureError(input.onInfrastructureError, 'VISUAL_PROGRESS', error);
    }
    if (committed) reportCheckpoint('COMMITTED');
    return result;
  } finally {
    try {
      attempt.dispose();
    } catch (error) {
      reportInfrastructureError(input.onInfrastructureError, 'LISTENER_CLEANUP', error);
    }
    try {
      input.onAttemptFinished?.(attempt);
    } catch (error) {
      reportInfrastructureError(input.onInfrastructureError, 'LISTENER_CLEANUP', error);
    }
  }
}
