import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../state/AuthContext';
import { errorClass, errorCode, logInfo, logWarn } from '../lib/logger';
import {
  completeScheduledSession,
  ensureScheduleConfigFromQuestionnaire,
  loadScheduleConfig,
  resolveMissedSession,
  resolveTodaysSchedule,
} from '../services/workoutSchedule';
import { normalizeWeekdays, trainingDaysValid } from '../lib/questionnaireSchema';
import { localDateInTimezone } from './localDate';
import type { MissDecision, ScheduleConfig, ScheduleResolution } from './types';
import type { WorkoutProgramSnapshot } from '../services/workoutPrograms';

const notAvailable: ScheduleResolution = { status: 'PROGRAM_NOT_AVAILABLE' };

export interface WorkoutScheduleController {
  resolution: ScheduleResolution;
  config: ScheduleConfig | null;
  loading: boolean;
  reload: () => Promise<void>;
  /** Call once the active WorkoutScreen session actually finishes. */
  completeSession: (sessionIndex: number) => Promise<void>;
  resolveMiss: (decision: MissDecision) => Promise<void>;
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
  const sessionCount = program?.sessions.length ?? 0;
  const activatedAtLocalDate = program?.activatedAt
    ? localDateInTimezone(program.activatedAt.toDate(), deviceTimezone())
    : null;

  const [resolution, setResolution] = useState<ScheduleResolution>(notAvailable);
  const [config, setConfig] = useState<ScheduleConfig | null>(null);
  const [loading, setLoading] = useState(true);

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
      if (!loadedConfig && questionnaire && trainingDaysValid(questionnaire.answers)) {
        loadedConfig = await ensureScheduleConfigFromQuestionnaire(
          uid,
          normalizeWeekdays(questionnaire.answers.trainingDays ?? []),
          deviceTimezone(),
        );
      }
      setConfig(loadedConfig);
      const timezone = loadedConfig?.timezone ?? deviceTimezone();
      const todayLocalDate = localDateInTimezone(new Date(), timezone);
      const result = await resolveTodaysSchedule({
        uid,
        programId,
        sessionCount,
        activatedAtLocalDate,
        todayLocalDate,
      });
      setResolution(result);
      logInfo('workout_schedule', 'schedule_resolved', { status: result.status });
    } catch (error) {
      logWarn('workout_schedule', 'schedule_resolve_failed', { error });
      setResolution(notAvailable);
    } finally {
      setLoading(false);
    }
  }, [uid, programId, sessionCount, activatedAtLocalDate, questionnaire]);

  useEffect(() => { void reload(); }, [reload]);

  const completeSession = useCallback(async (sessionIndex: number) => {
    if (!uid || !programId || sessionCount === 0) return;
    const timezone = config?.timezone ?? deviceTimezone();
    const scheduledLocalDate = localDateInTimezone(new Date(), timezone);
    // Diagnostic instrumentation (Phase 2, Part F) — technical fields only.
    logInfo('workout_schedule', 'schedule_completion_started', { programId, sessionIndex });
    try {
      await completeScheduledSession({ uid, programId, sessionIndex, sessionCount, scheduledLocalDate });
      logInfo('workout_schedule', 'schedule_completion_succeeded', { programId, sessionIndex });
    } catch (error) {
      logWarn('workout_schedule', 'schedule_complete_failed', { error });
      logWarn('workout_schedule', 'schedule_completion_failed', {
        programId,
        sessionIndex,
        errorCode: errorCode(error),
        errorClass: errorClass(error),
      });
    } finally {
      await reload();
    }
  }, [uid, programId, sessionCount, config, reload]);

  const resolveMiss = useCallback(async (decision: MissDecision) => {
    if (!uid || !programId || sessionCount === 0) return;
    const timezone = config?.timezone ?? deviceTimezone();
    const todayLocalDate = localDateInTimezone(new Date(), timezone);
    try {
      await resolveMissedSession({ uid, programId, sessionCount, decision, todayLocalDate });
    } catch (error) {
      logWarn('workout_schedule', 'schedule_miss_resolution_failed', { error });
    } finally {
      await reload();
    }
  }, [uid, programId, sessionCount, config, reload]);

  return { resolution, config, loading, reload, completeSession, resolveMiss };
}
