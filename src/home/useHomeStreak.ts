import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../state/AuthContext';
import type { ScheduleMode, Weekday } from '../state/AppState';
import { localDateInTimezone } from '../scheduleEngine/localDate';
import { listCompletedWorkoutActivityDatesInRange } from '../services/workoutExecutions';
import { fetchWidgetStreakHistory } from '../widgets/widgetStreakHistoryFetch';
import type { Streak } from './streak';

export interface UseHomeStreakInput {
  timezone: string;
  hasActiveProgram: boolean;
  scheduleMode?: ScheduleMode;
  prescribedTrainingFrequency?: number;
  trainingDays: readonly Weekday[];
  activeRecoveryDays: readonly Weekday[];
}

/**
 * Home-only streak read — deliberately separate from `useWidgetSnapshotSync`
 * (never modifies it). Reuses the exact same pure/service functions the
 * widget already uses (`fetchWidgetStreakHistory`, which internally calls
 * `computeStreak`), so this introduces one new bounded Firestore read per
 * Home load/foreground, never a new calculation (Home redesign plan,
 * "Sequência (streak)" decision).
 *
 * Returns `null` until the first successful read — the Home ticker/ring must
 * simply omit the streak item while this is `null`, never show a fabricated
 * 0.
 */
export function useHomeStreak(input: UseHomeStreakInput): Streak | null {
  const { user } = useAuth();
  const [streak, setStreak] = useState<Streak | null>(null);
  const uid = user?.uid ?? null;
  const trainingDaysKey = input.trainingDays.join(',');
  const activeRecoveryDaysKey = input.activeRecoveryDays.join(',');

  const load = useCallback(async () => {
    if (!uid || !input.hasActiveProgram) {
      setStreak(null);
      return;
    }
    try {
      const today = localDateInTimezone(new Date(), input.timezone);
      const result = await fetchWidgetStreakHistory({
        uid,
        todayLocalDate: today,
        streakInput: {
          scheduleMode: input.scheduleMode,
          prescribedTrainingFrequency: input.prescribedTrainingFrequency,
          trainingDays: input.trainingDays,
          activeRecoveryDays: input.activeRecoveryDays,
        },
        fetchRange: listCompletedWorkoutActivityDatesInRange,
      });
      setStreak(result.streak);
    } catch {
      // A transient failure must never blank an already-shown real streak —
      // same "never flash a worse state" contract the rest of Home follows.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    uid,
    input.hasActiveProgram,
    input.timezone,
    input.scheduleMode,
    input.prescribedTrainingFrequency,
    trainingDaysKey,
    activeRecoveryDaysKey,
  ]);

  useEffect(() => {
    void load();
  }, [load]);

  return streak;
}
