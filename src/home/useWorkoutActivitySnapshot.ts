import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../state/AuthContext';
import { logWarn } from '../lib/logger';
import type { ScheduleMode, Weekday } from '../state/AppState';
// Concrete submodules only — see `calendarWeek.ts` for why the
// `../scheduleEngine` barrel must never be imported from a module that
// isn't itself the `useWorkoutSchedule` hook.
import { type LocalDate } from '../scheduleEngine/calendar';
import { localDateInTimezone } from '../scheduleEngine/localDate';
import { listCompletedWorkoutActivityDatesInRange } from '../services/workoutExecutions';
import { mondayOfWeek } from './calendarWeek';
import { buildWeekOverview, type WeekOverviewViewModel } from './weekOverview';
import type { InitialSectionStatus } from './homeInitialReadiness';

export interface WorkoutActivitySnapshot {
  /** True only until the first read resolves — mirrors `useWorkoutEvolution`'s loading contract (never re-flashes on a background reload). */
  loading: boolean;
  initialStatus: InitialSectionStatus;
  week: WeekOverviewViewModel | null;
  reload: () => Promise<void>;
}

/**
 * Single bounded Firestore read (`listCompletedWorkoutActivityDatesInRange`) behind
 * the Home "esta semana" projection — never a live listener, since the one
 * real mutation (finishing a workout) already has an explicit call site
 * (`AppShell`'s post-completion flow) that can call `reload()`, the same
 * pattern `useWorkoutSchedule`/`useWorkoutEvolution` use for their own
 * explicit refreshes. "Sua frequência" has its own independently-paginated
 * fetch (`useFrequencyWindow`) since it reaches further back than the
 * current calendar week.
 */
export function useWorkoutActivitySnapshot(input: {
  timezone: string;
  scheduleMode?: ScheduleMode;
  prescribedTrainingFrequency?: number;
  trainingDays: readonly Weekday[];
  activeRecoveryDays: readonly Weekday[];
  activatedAtLocalDate: LocalDate | null;
}): WorkoutActivitySnapshot {
  const { user } = useAuth();
  const uid = user?.uid ?? null;
  const [completedDates, setCompletedDates] = useState<ReadonlySet<LocalDate> | null>(null);
  const [fulfilledScheduledDates, setFulfilledScheduledDates] = useState<ReadonlySet<LocalDate> | null>(null);
  const [loading, setLoading] = useState(true);
  const [initialStatus, setInitialStatus] = useState<InitialSectionStatus>(uid ? 'PENDING' : 'NOT_APPLICABLE');
  const trainingDaysKey = input.trainingDays.join(',');
  const activeRecoveryDaysKey = input.activeRecoveryDays.join(',');

  const reload = useCallback(async () => {
    if (!uid) {
      setCompletedDates(null);
      setFulfilledScheduledDates(null);
      setLoading(false);
      setInitialStatus('NOT_APPLICABLE');
      return;
    }
    try {
      const today = localDateInTimezone(new Date(), input.timezone);
      const from = mondayOfWeek(today);
      const dates = await listCompletedWorkoutActivityDatesInRange(uid, from, today);
      setCompletedDates(new Set(dates.performedDates));
      setFulfilledScheduledDates(new Set(dates.scheduledDates));
      setInitialStatus((previous) => previous === 'PENDING' ? 'SUCCESS' : previous);
    } catch (error) {
      logWarn('home_activity', 'load_failed', { error });
      // Keep the last known set on a transient failure; only default to
      // empty on the very first load, matching `useWorkoutEvolution`'s "never
      // flash a worse state than what's already on screen" contract.
      setCompletedDates((previous) => previous ?? new Set());
      setFulfilledScheduledDates((previous) => previous ?? new Set());
      setInitialStatus((previous) => previous === 'PENDING' ? 'ERROR' : previous);
    } finally {
      setLoading(false);
    }
  }, [uid, input.timezone]);

  useEffect(() => { void reload(); }, [reload]);

  const today = uid ? localDateInTimezone(new Date(), input.timezone) : null;

  const week = useMemo(() => {
    if (!completedDates || !fulfilledScheduledDates || !today) return null;
    return buildWeekOverview({
      todayLocalDate: today,
      scheduleMode: input.scheduleMode ?? 'fixed',
      prescribedTrainingFrequency: input.prescribedTrainingFrequency,
      trainingDays: input.trainingDays,
      activeRecoveryDays: input.activeRecoveryDays,
      activatedAtLocalDate: input.activatedAtLocalDate,
      completedDates,
      fulfilledScheduledDates,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [completedDates, fulfilledScheduledDates, today, trainingDaysKey, activeRecoveryDaysKey, input.activatedAtLocalDate, input.scheduleMode, input.prescribedTrainingFrequency]);

  return { loading, initialStatus, week, reload };
}
