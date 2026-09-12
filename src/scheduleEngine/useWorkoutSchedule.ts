import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { useAuth } from '../state/AuthContext';
import { errorClass, errorCode, logInfo, logWarn } from '../lib/logger';
import {
  ensureScheduleConfigFromQuestionnaire,
  hasScheduledSessionCompletion,
  loadScheduleConfig,
  resolveMissedSession,
  resolveTodaysSchedule,
} from '../services/workoutSchedule';
import { finalizeWorkoutSession } from '../services/finalizeWorkoutSession';
import { listExecutionsForProgram, type PersistedWorkoutExecution } from '../services/workoutExecutions';
import { normalizeWeekdays, trainingDaysValid } from '../lib/questionnaireSchema';
import { localDateInTimezone } from './localDate';
import type { MissDecision, ScheduleConfig, ScheduleResolution } from './types';
import type { WorkoutProgramSnapshot } from '../services/workoutPrograms';
import { legacyTrainingDays } from '../workoutPrescription/weeklySchedule';

const notAvailable: ScheduleResolution = { status: 'PROGRAM_NOT_AVAILABLE' };

/**
 * Finds the newest terminal execution belonging to the active program
 * instance. This is the crash-recovery bridge for the narrow window where
 * Execution committed but Schedule did not. ABANDONED is never completion.
 */
export function terminalExecutionForScheduleRecovery(
  executions: readonly PersistedWorkoutExecution[],
  programInstanceId: string | null,
): PersistedWorkoutExecution | null {
  return executions
    .filter((item) => (
      item.status === 'COMPLETED' || item.status === 'PARTIALLY_COMPLETED'
    ) && (programInstanceId ? item.programInstanceId === programInstanceId : !item.programInstanceId))
    .sort((a, b) => b.scheduledLocalDate.localeCompare(a.scheduledLocalDate))[0] ?? null;
}

export interface WorkoutScheduleController {
  resolution: ScheduleResolution;
  config: ScheduleConfig | null;
  loading: boolean;
  reload: () => Promise<void>;
  /** Resolves a pending miss decision. Returns whether it actually succeeded — callers must not advance their own flow (e.g. opening the start confirmation) on a `false` result. */
  resolveMiss: (decision: MissDecision) => Promise<boolean>;
}

function deviceTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/**
 * Bridges the pure Schedule Engine (src/scheduleEngine/) to the active
 * program from `useWorkoutPrescription`. Read-only besides the single,
 * idempotent "first miss detected" write inside `resolveTodaysSchedule`
 * (docs/workout-lifecycle/03_SCHEDULE_ENGINE.md) — opening the app never
 * otherwise changes program or schedule state.
 */
export function useWorkoutSchedule(program: WorkoutProgramSnapshot | null): WorkoutScheduleController {
  const { user, questionnaire } = useAuth();
  const uid = user?.uid ?? null;
  const programId = program?.programId ?? null;
  const programInstanceId = program?.programInstanceId ?? null;
  const prescribedProgramDays = useMemo(() => (program ? legacyTrainingDays(program) : []), [program]);
  const prescribedRecoveryDays = useMemo(() => program?.weeklySchedule
    ?.filter((day) => day.state === 'ACTIVE_RECOVERY')
    .map((day) => day.weekday) ?? [], [program]);
  const sessionCount = program
    ? program.prescribedTrainingFrequency ?? program.prescribedStructuredDays ?? program.sessions.length
    : 0;
  const authoritativeActivatedAt = program?.programInstanceActivatedAt ?? program?.activatedAt;
  const activatedAtLocalDate = authoritativeActivatedAt
    ? localDateInTimezone(authoritativeActivatedAt.toDate(), deviceTimezone())
    : null;

  const [resolution, setResolution] = useState<ScheduleResolution>(notAvailable);
  const [config, setConfig] = useState<ScheduleConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  // Retains the background refresh Promise so post-durable Schedule
  // projection work is explicit and never an unhandled fire-and-forget.
  const completionReloadRef = useRef<Promise<void> | null>(null);

  const reload = useCallback(async () => {
    if (!uid) {
      setResolution(notAvailable);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      let loadedConfig = await loadScheduleConfig(uid);
      // Reconciliation, not a second question: the questionnaire already
      // asked `trainingDays` — if the Schedule Engine has no config yet
      // AND that answer is valid, bridge it across automatically instead of
      // ever showing SCHEDULE_SETUP_REQUIRED for something already known.
      // `ensureScheduleConfigFromQuestionnaire` is create-only (never
      // overwrites a config the user edited afterward) and transaction-
      // guarded (safe against this hook mounting twice concurrently) — see
      // its doc comment in `services/workoutSchedule.ts`.
      if (!loadedConfig && prescribedProgramDays.length > 0) {
        loadedConfig = await ensureScheduleConfigFromQuestionnaire(
          uid,
          prescribedProgramDays,
          deviceTimezone(),
        );
      } else if (!loadedConfig && questionnaire && trainingDaysValid(questionnaire.answers)) {
        loadedConfig = await ensureScheduleConfigFromQuestionnaire(
          uid,
          normalizeWeekdays(questionnaire.answers.trainingDays ?? []),
          deviceTimezone(),
        );
      }
      const effectiveConfig = loadedConfig && prescribedProgramDays.length > 0
        ? { ...loadedConfig, trainingDays: prescribedProgramDays, activeRecoveryDays: prescribedRecoveryDays }
        : loadedConfig;
      setConfig(effectiveConfig);

      // Process-death recovery, case B: finishWorkoutExecution atomically
      // terminalizes the execution and clears the active mutex, so `current`
      // intentionally cannot be used as a completion marker. Re-discover the
      // terminal execution from Firestore and resume only the missing,
      // idempotent Schedule mutation. Both documents remain authoritative.
      if (programId && effectiveConfig?.trainingDays.length && activatedAtLocalDate) {
        try {
          const candidate = terminalExecutionForScheduleRecovery(
            await listExecutionsForProgram(uid, programId),
            programInstanceId,
          );
          if (candidate && !(await hasScheduledSessionCompletion({
            uid,
            programId,
            ...(programInstanceId ? { programInstanceId } : {}),
            sessionIndex: candidate.sessionIndex,
            scheduledLocalDate: candidate.scheduledLocalDate,
          }))) {
            logInfo('workout_schedule', 'terminal_execution_schedule_recovery_started', {});
            await finalizeWorkoutSession({ executionId: candidate.executionId });
            logInfo('workout_schedule', 'terminal_execution_schedule_recovery_completed', {});
          }
        } catch (error) {
          // Fail closed: a still-missing Schedule fact remains retryable on
          // foreground/cold start and is never presented as completed here.
          logWarn('workout_schedule', 'terminal_execution_schedule_recovery_failed', {
            errorCode: errorCode(error),
            errorClass: errorClass(error),
          });
        }
      }
      const timezone = loadedConfig?.timezone ?? deviceTimezone();
      const todayLocalDate = localDateInTimezone(new Date(), timezone);
      const result = await resolveTodaysSchedule({
        uid,
        programId,
        programInstanceId,
        sessionCount,
        activatedAtLocalDate,
        todayLocalDate,
        trainingDaysOverride: prescribedProgramDays,
        activeRecoveryDaysOverride: prescribedRecoveryDays,
      });
      setResolution(result);
      logInfo('workout_schedule', 'schedule_resolved', { status: result.status });
    } catch (error) {
      logWarn('workout_schedule', 'schedule_resolve_failed', { error });
      setResolution(notAvailable);
    } finally {
      setLoading(false);
    }
  }, [uid, programId, programInstanceId, sessionCount, activatedAtLocalDate, questionnaire, prescribedProgramDays, prescribedRecoveryDays]);

  useEffect(() => { void reload(); }, [reload]);

  const reloadAfterCompletion = useCallback(() => {
    const reloadStartedAtMs = Date.now();
    logInfo('workout_performance', 'schedule_reload_start', { timestampMs: reloadStartedAtMs });
    const operation = reload()
      .catch((error) => {
        logWarn('workout_schedule', 'schedule_completion_reload_failed', {
          errorCode: errorCode(error),
          errorClass: errorClass(error),
        });
      })
      .finally(() => {
        logInfo('workout_performance', 'schedule_reload_end', {
          timestampMs: Date.now(),
          durationMs: Date.now() - reloadStartedAtMs,
        });
        if (completionReloadRef.current === operation) completionReloadRef.current = null;
      });
    completionReloadRef.current = operation;
    return operation;
  }, [reload]);

  // A completion-time projection reload can fail while the durable Schedule
  // write remains correct. Retry presentation on the next real foreground
  // transition; cold start is already covered by the mount-time reload.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      const previousState = appStateRef.current;
      appStateRef.current = nextState;
      if (nextState === 'active' && previousState !== 'active') reloadAfterCompletion();
    });
    return () => subscription.remove();
  }, [reloadAfterCompletion]);

  const resolveMiss = useCallback(async (decision: MissDecision) => {
    if (!uid || !programId || sessionCount === 0) return false;
    const timezone = config?.timezone ?? deviceTimezone();
    const todayLocalDate = localDateInTimezone(new Date(), timezone);
    try {
      await resolveMissedSession({ uid, programId, ...(programInstanceId ? { programInstanceId } : {}), sessionCount, decision, todayLocalDate });
      return true;
    } catch (error) {
      logWarn('workout_schedule', 'schedule_miss_resolution_failed', { error });
      return false;
    } finally {
      await reload();
    }
  }, [uid, programId, programInstanceId, sessionCount, config, reload]);

  return { resolution, config, loading, reload, resolveMiss };
}
