import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { useAuth } from '../state/AuthContext';
import { errorClass, errorCode, logInfo, logWarn } from '../lib/logger';
import { recordPerfMark } from '../lib/perf';
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
import { takeScheduleConfigBootstrapHandoff } from './scheduleConfigBootstrapHandoff';
import type {
  MissDecision,
  MissedSessionDecisionIdentity,
  ScheduleConfig,
  ScheduleResolution,
} from './types';
import {
  classifyMissResolutionOutcome,
  type MissResolutionOutcome,
} from './missedDecisionResolution';
import type { WorkoutProgramSnapshot } from '../services/workoutPrograms';
import { legacyTrainingDays } from '../workoutPrescription/weeklySchedule';
import {
  applyScheduleReloadOutcome,
  type ScheduleRefreshError,
  type ScheduleRefreshProjection,
} from './scheduleRefreshState';

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
  /** Last refresh failure, separate from the last authoritative resolution. */
  refreshError: ScheduleRefreshError | null;
  reload: () => Promise<ScheduleResolution | null>;
  /** Resolves only the exact missed occurrence captured when the modal opened. */
  resolveMiss: (
    decision: MissDecision,
    expected: MissedSessionDecisionIdentity,
  ) => Promise<MissResolutionOutcome>;
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
  const scheduleMode = program?.scheduleMode ?? 'fixed';
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

  const [projection, setProjection] = useState<ScheduleRefreshProjection>({
    resolution: notAvailable,
    refreshError: null,
  });
  const [config, setConfig] = useState<ScheduleConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const reloadSequenceRef = useRef(0);
  const scheduleScopeKey = uid
    ? `${uid}:${programInstanceId ?? programId ?? 'no-program'}`
    : null;
  const scheduleScopeRef = useRef(scheduleScopeKey);
  // Retains the background refresh Promise so post-durable Schedule
  // projection work is explicit and never an unhandled fire-and-forget.
  const completionReloadRef = useRef<Promise<unknown> | null>(null);

  const reload = useCallback(async () => {
    const reloadId = ++reloadSequenceRef.current;
    const reloadStartedAtMs = Date.now();
    if (scheduleScopeRef.current !== scheduleScopeKey) {
      scheduleScopeRef.current = scheduleScopeKey;
      setProjection({ resolution: notAvailable, refreshError: null });
      setConfig(null);
    }
    if (!uid) {
      setProjection({ resolution: notAvailable, refreshError: null });
      setConfig(null);
      setLoading(false);
      return notAvailable;
    }
    // No active program yet (still resolving in `useWorkoutPrescription`, or
    // genuinely none). `resolveTodaysSchedule`'s own `!hasActiveProgram`
    // branch (scheduleEngine/resolver.ts) returns `PROGRAM_NOT_AVAILABLE`
    // unconditionally without ever reading `config`/`state` — so fetching
    // them here first only to throw the read away. Mirrors that exact
    // `hasActiveProgram` condition. `config` is left as-is (not reset) so an
    // already-loaded value isn't discarded for nothing.
    if (!programId || sessionCount <= 0) {
      setProjection({ resolution: notAvailable, refreshError: null });
      setLoading(false);
      return notAvailable;
    }
    setLoading(true);
    try {
      let loadedConfig = takeScheduleConfigBootstrapHandoff(uid) ?? await loadScheduleConfig(uid);
      // Reconciliation, not a second question: the questionnaire already
      // asked `trainingDays` — if the Schedule Engine has no config yet
      // AND that answer is valid, bridge it across automatically instead of
      // ever showing SCHEDULE_SETUP_REQUIRED for something already known.
      // `ensureScheduleConfigFromQuestionnaire` is create-only (never
      // overwrites a config the user edited afterward) and transaction-
      // guarded (safe against this hook mounting twice concurrently) — see
      // its doc comment in `services/workoutSchedule.ts`.
      if (!loadedConfig && (scheduleMode === 'flexible' || prescribedProgramDays.length > 0)) {
        loadedConfig = await ensureScheduleConfigFromQuestionnaire(
          uid,
          prescribedProgramDays,
          deviceTimezone(),
          scheduleMode,
        );
      } else if (!loadedConfig && questionnaire && trainingDaysValid(questionnaire.answers)) {
        loadedConfig = await ensureScheduleConfigFromQuestionnaire(
          uid,
          normalizeWeekdays(questionnaire.answers.trainingDays ?? []),
          deviceTimezone(),
          questionnaire.answers.scheduleMode ?? 'fixed',
        );
      }
      const effectiveConfig = loadedConfig && prescribedProgramDays.length > 0
        ? { ...loadedConfig, trainingDays: prescribedProgramDays, activeRecoveryDays: prescribedRecoveryDays }
        : loadedConfig;
      recordPerfMark('today_schedule_config_ready');

      // Process-death recovery, case B: finishWorkoutExecution atomically
      // terminalizes the execution and clears the active mutex, so `current`
      // intentionally cannot be used as a completion marker. Re-discover the
      // terminal execution from Firestore and resume only the missing,
      // idempotent Schedule mutation. Both documents remain authoritative.
      if (programId && (scheduleMode === 'flexible' || effectiveConfig?.trainingDays.length) && activatedAtLocalDate) {
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
      recordPerfMark('today_schedule_recovery_checked');
      const timezone = loadedConfig?.timezone ?? deviceTimezone();
      const todayLocalDate = localDateInTimezone(new Date(), timezone);
      const result = await resolveTodaysSchedule({
        uid,
        programId,
        programInstanceId,
        sessionCount,
        scheduleMode,
        activatedAtLocalDate,
        todayLocalDate,
        trainingDaysOverride: prescribedProgramDays,
        activeRecoveryDaysOverride: prescribedRecoveryDays,
        // Already awaited above (`loadedConfig`) — same uid, same document,
        // no write in between. Skips resolveTodaysSchedule's own otherwise-
        // redundant `loadScheduleConfig` read.
        storedConfig: loadedConfig,
      });
      recordPerfMark('today_schedule_resolved');
      if (reloadId === reloadSequenceRef.current) setConfig(effectiveConfig);
      setProjection((current) => applyScheduleReloadOutcome(current, reloadSequenceRef.current, {
        kind: 'success',
        reloadId,
        resolution: result,
      }));
      logInfo('workout_schedule', 'schedule_resolved', {
        status: result.status,
        durationMs: Date.now() - reloadStartedAtMs,
        reloadId,
        applied: reloadId === reloadSequenceRef.current,
      });
      return reloadId === reloadSequenceRef.current ? result : null;
    } catch (error) {
      const refreshError = {
        code: errorCode(error),
        errorClass: errorClass(error),
      };
      setProjection((current) => applyScheduleReloadOutcome(current, reloadSequenceRef.current, {
        kind: 'failure',
        reloadId,
        error: refreshError,
      }));
      logWarn('workout_schedule', 'schedule_resolve_failed', {
        durationMs: Date.now() - reloadStartedAtMs,
        reloadId,
        errorCode: refreshError.code,
        errorClass: refreshError.errorClass,
        resolutionPreserved: true,
        ignoredAsStale: reloadId !== reloadSequenceRef.current,
      });
      return null;
    } finally {
      if (reloadId === reloadSequenceRef.current) setLoading(false);
    }
  }, [uid, programId, programInstanceId, sessionCount, scheduleMode, activatedAtLocalDate, questionnaire, prescribedProgramDays, prescribedRecoveryDays, scheduleScopeKey]);

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

  const missResolutionInFlightRef = useRef<Promise<MissResolutionOutcome> | null>(null);
  const resolveMiss = useCallback((
    decision: MissDecision,
    expected: MissedSessionDecisionIdentity,
  ): Promise<MissResolutionOutcome> => {
    if (missResolutionInFlightRef.current) return missResolutionInFlightRef.current;
    if (scheduleMode === 'flexible' || !uid || !programId || sessionCount === 0) {
      return Promise.resolve({ status: 'FAILED', resolution: null });
    }
    const timezone = config?.timezone ?? deviceTimezone();
    const todayLocalDate = localDateInTimezone(new Date(), timezone);
    const operation = (async (): Promise<MissResolutionOutcome> => {
      let failure: unknown | null = null;
      try {
        await resolveMissedSession({
          uid,
          programId,
          ...(programInstanceId ? { programInstanceId } : {}),
          sessionCount,
          decision,
          todayLocalDate,
          expected,
        });
      } catch (error) {
        failure = error;
        logWarn('workout_schedule', 'schedule_miss_resolution_failed', { error });
      }
      const resolution = await reload();
      return classifyMissResolutionOutcome({ error: failure, expected, resolution });
    })();
    missResolutionInFlightRef.current = operation;
    const release = () => {
      if (missResolutionInFlightRef.current === operation) missResolutionInFlightRef.current = null;
    };
    void operation.then(release, release);
    return operation;
  }, [uid, programId, programInstanceId, sessionCount, scheduleMode, config, reload]);

  return {
    resolution: projection.resolution,
    config,
    loading,
    refreshError: projection.refreshError,
    reload,
    resolveMiss,
  };
}
