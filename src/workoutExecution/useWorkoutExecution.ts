import { useCallback, useState } from 'react';
import { useAuth } from '../state/AuthContext';
import { errorClass, errorCode, logInfo, logWarn } from '../lib/logger';
import { localDateInTimezone } from '../scheduleEngine/localDate';
import {
  abandonWorkoutExecution,
  finishWorkoutExecution,
  recordSetExecution,
  skipExerciseExecution,
  skipSetExecution,
  startOrResumeWorkoutExecution,
  type PersistedWorkoutExecution,
} from '../services/workoutExecutions';
import type { WorkoutProgramSnapshot } from '../services/workoutPrograms';

function deviceTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export interface WorkoutExecutionController {
  execution: PersistedWorkoutExecution | null;
  starting: boolean;
  /** Starts (or resumes, or restarts after abandon) the execution for `sessionIndex` — idempotent (docs §22–25). */
  start: (sessionIndex: number) => Promise<PersistedWorkoutExecution | null>;
  recordSet: (exerciseIndex: number, setIndex: number, weightKg: number | null, actualReps?: number | null) => Promise<void>;
  skipSet: (exerciseIndex: number, setIndex: number) => Promise<void>;
  skipExercise: (exerciseIndex: number) => Promise<void>;
  /** Sweeps any pending sets to SKIPPED and marks the execution COMPLETED/PARTIALLY_COMPLETED. Does not touch the Schedule Engine — the caller advances it afterward (docs §40). */
  finish: () => Promise<'COMPLETED' | 'PARTIALLY_COMPLETED' | null>;
  /** Distinct from `finish` — never advances the Schedule Engine (docs §36). */
  abandon: () => Promise<void>;
}

/**
 * Bridges the Firestore-backed Execution service (src/services/
 * workoutExecutions.ts) to the active program/session, mirroring
 * `useWorkoutSchedule`'s shape. Owned by `AppShell` — `WorkoutScreen` stays
 * presentation-only and reaches persistence only through the callbacks this
 * hook produces (docs/workout-lifecycle/09_WORKOUT_EXECUTION_AND_HISTORY.md).
 */
export function useWorkoutExecution(program: WorkoutProgramSnapshot | null, timezone: string | undefined): WorkoutExecutionController {
  const { user } = useAuth();
  const uid = user?.uid ?? null;
  const [execution, setExecution] = useState<PersistedWorkoutExecution | null>(null);
  const [starting, setStarting] = useState(false);

  const start = useCallback(async (sessionIndex: number) => {
    if (!uid || !program) return null;
    setStarting(true);
    try {
      const scheduledLocalDate = localDateInTimezone(new Date(), timezone ?? deviceTimezone());
      const result = await startOrResumeWorkoutExecution({ uid, program, sessionIndex, scheduledLocalDate });
      setExecution(result);
      return result;
    } catch (error) {
      logWarn('workout_execution', 'start_failed', { error });
      setExecution(null);
      return null;
    } finally {
      setStarting(false);
    }
  }, [uid, program, timezone]);

  const recordSet = useCallback(async (exerciseIndex: number, setIndex: number, weightKg: number | null, actualReps: number | null = null) => {
    if (!uid || !execution) return;
    try {
      await recordSetExecution({ uid, executionId: execution.executionId, exerciseIndex, setIndex, weightKg, actualReps });
    } catch (error) {
      logWarn('workout_execution', 'record_set_failed', { error });
    }
  }, [uid, execution]);

  const skipSet = useCallback(async (exerciseIndex: number, setIndex: number) => {
    if (!uid || !execution) return;
    try {
      await skipSetExecution({ uid, executionId: execution.executionId, exerciseIndex, setIndex });
    } catch (error) {
      logWarn('workout_execution', 'skip_set_failed', { error });
    }
  }, [uid, execution]);

  const skipExercise = useCallback(async (exerciseIndex: number) => {
    if (!uid || !execution) return;
    try {
      await skipExerciseExecution({ uid, executionId: execution.executionId, exerciseIndex });
    } catch (error) {
      logWarn('workout_execution', 'skip_exercise_failed', { error });
    }
  }, [uid, execution]);

  const finish = useCallback(async () => {
    if (!uid || !execution) return null;
    // Diagnostic instrumentation (Phase 2, Part F) — technical fields only
    // (never questionnaire/personal data), added to trace the exact point a
    // prior E2E crash was reported at. That crash was later explained by a
    // separate cause (Schedule stuck in SCHEDULE_SETUP_REQUIRED, fixed in
    // Phase 1) — this instrumentation is precautionary for the next E2E,
    // not a fix for a confirmed bug in this function.
    logInfo('workout_execution', 'execution_finish_started', {
      programId: execution.programId,
      executionId: execution.executionId,
      sessionIndex: execution.sessionIndex,
    });
    try {
      const result = await finishWorkoutExecution(uid, execution.executionId);
      setExecution((prev) => (prev ? { ...prev, status: result.status, finishedAt: prev.finishedAt } : prev));
      logInfo('workout_execution', 'execution_finish_succeeded', {
        programId: execution.programId,
        executionId: execution.executionId,
        sessionIndex: execution.sessionIndex,
        status: result.status,
      });
      return result.status;
    } catch (error) {
      logWarn('workout_execution', 'finish_failed', { error });
      logWarn('workout_execution', 'execution_finish_failed', {
        programId: execution.programId,
        executionId: execution.executionId,
        sessionIndex: execution.sessionIndex,
        errorCode: errorCode(error),
        errorClass: errorClass(error),
      });
      return null;
    }
  }, [uid, execution]);

  const abandon = useCallback(async () => {
    if (!uid || !execution) return;
    try {
      await abandonWorkoutExecution(uid, execution.executionId);
    } catch (error) {
      logWarn('workout_execution', 'abandon_failed', { error });
    }
  }, [uid, execution]);

  return { execution, starting, start, recordSet, skipSet, skipExercise, finish, abandon };
}
