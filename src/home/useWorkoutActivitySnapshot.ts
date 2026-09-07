import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../state/AuthContext';
import { logWarn } from '../lib/logger';
import type { Weekday } from '../state/AppState';
// Concrete submodules only — see `calendarWeek.ts` for why the
// `../scheduleEngine` barrel must never be imported from a module that
// isn't itself the `useWorkoutSchedule` hook.
import { type LocalDate } from '../scheduleEngine/calendar';
import { localDateInTimezone } from '../scheduleEngine/localDate';
import { listCompletedWorkoutDatesInRange } from '../services/workoutExecutions';
import { mondayOfWeek } from './calendarWeek';
import { buildWeekOverview, type WeekOverviewViewModel } from './weekOverview';

export interface WorkoutActivitySnapshot {
  /** True only until the first read resolves — mirrors `useWorkoutEvolution`'s loading contract (never re-flashes on a background reload). */
  loading: boolean;
  week: WeekOverviewViewModel | null;
  reload: () => Promise<void>;
}

/**
 * Single bounded Firestore read (`listCompletedWorkoutDatesInRange`) behind
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
  trainingDays: readonly Weekday[];
  activeRecoveryDays: readonly Weekday[];
  activatedAtLocalDate: LocalDate | null;
}): WorkoutActivitySnapshot {
  const { user } = useAuth();
  const uid = user?.uid ?? null;
  const [completedDates, setCompletedDates] = useState<ReadonlySet<LocalDate> | null>(null);
  const [loading, setLoading] = useState(true);
  const trainingDaysKey = input.trainingDays.join(',');
  const activeRecoveryDaysKey = input.activeRecoveryDays.join(',');

  const reload = useCallback(async () => {
    if (!uid) {
      setCompletedDates(null);
      setLoading(false);
      return;
    }
    try {
      const today = localDateInTimezone(new Date(), input.timezone);
      const from = mondayOfWeek(today);
      const dates = await listCompletedWorkoutDatesInRange(uid, from, today);
      setCompletedDates(new Set(dates));
    } catch (error) {
      logWarn('home_activity', 'load_failed', { error });
      // Keep the last known set on a transient failure; only default to
      // empty on the very first load, matching `useWorkoutEvolution`'s "never
      // flash a worse state than what's already on screen" contract.
      setCompletedDates((previous) => previous ?? new Set());
    } finally {
      setLoading(false);
    }
  }, [uid, input.timezone]);

  useEffect(() => { void reload(); }, [reload]);

  const today = uid ? localDateInTimezone(new Date(), input.timezone) : null;

  const week = useMemo(() => {
    if (!completedDates || !today) return null;
    return buildWeekOverview({
      todayLocalDate: today,
      trainingDays: input.trainingDays,
      activeRecoveryDays: input.activeRecoveryDays,
      activatedAtLocalDate: input.activatedAtLocalDate,
      completedDates,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [completedDates, today, trainingDaysKey, activeRecoveryDaysKey, input.activatedAtLocalDate]);

  return { loading, week, reload };
}
