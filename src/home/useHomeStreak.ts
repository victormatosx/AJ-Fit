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

export interface UseHomeStreakResult {
  streak: Streak | null;
  /**
   * Re-runs the same bounded read on demand — callers must invoke this after
   * finishing a workout, since none of this hook's own effect deps (schedule
   * config) change when a session completes.
   *
   * Resolves with the freshly-read `Streak` so a caller that needs the value
   * at a precise moment (the post-completion milestone check in `AppShell`)
   * can use it directly, instead of racing the `streak` state commit. `null`
   * means "no authoritative value" — no user/program, or the read failed —
   * and must never be treated as a streak of 0.
   */
  reload: () => Promise<Streak | null>;
}

/**
 * Home-only streak read — deliberately separate from `useWidgetSnapshotSync`
 * (never modifies it). Reuses the exact same pure/service functions the
 * widget already uses (`fetchWidgetStreakHistory`, which internally calls
 * `computeStreak`), so this introduces one new bounded Firestore read per
 * Home load/foreground, never a new calculation (Home redesign plan,
 * "Sequência (streak)" decision).
 *
 * `streak` is `null` until the first successful read — the Home ticker/ring
 * must simply omit the streak item while this is `null`, never show a
 * fabricated 0.
 */
export function useHomeStreak(input: UseHomeStreakInput): UseHomeStreakResult {
  const { user } = useAuth();
  const [streak, setStreak] = useState<Streak | null>(null);
  const uid = user?.uid ?? null;
  const trainingDaysKey = input.trainingDays.join(',');
  const activeRecoveryDaysKey = input.activeRecoveryDays.join(',');

  const load = useCallback(async (): Promise<Streak | null> => {
    if (!uid || !input.hasActiveProgram) {
      setStreak(null);
      return null;
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
      return result.streak;
    } catch {
      // A transient failure must never blank an already-shown real streak —
      // same "never flash a worse state" contract the rest of Home follows.
      return null;
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

  return { streak, reload: load };
}
