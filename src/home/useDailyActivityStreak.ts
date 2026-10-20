import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { useAuth } from '../state/AuthContext';
import { addDaysLocal, type LocalDate } from '../scheduleEngine/calendar';
import { localDateInTimezone } from '../scheduleEngine/localDate';
import { listCompletedWorkoutActivityDatesInRange } from '../services/workoutExecutions';
import {
  ensureStreakTimezone,
  listNutritionActivityDays,
  type StreakSettings,
} from '../services/nutritionActivityDays';
import {
  computeDailyActivityStreak,
  dailyActivityLookbackDays,
  unionActivityDays,
  type DailyActivityStreak,
} from './dailyActivityStreak';

/**
 * The daily activity streak as the Home and the widget show it.
 *
 * Deliberately separate from `useHomeStreak` (training obligations/weeks),
 * which is untouched and still feeds adherence and the schedule surfaces.
 *
 * ## Registration day, not activity date
 *
 * Both sources are read as "when was this REGISTERED", never "when does the
 * user say it happened":
 *
 *  - Workouts: `performedLocalDate`, which the finalize Cloud Function
 *    validates equals the execution's creation day in the user's timezone,
 *    so it cannot be back-dated at all.
 *  - Nutrition: the day document's immutable, server-set `createdAt` — see
 *    `listNutritionRegistrationDays`.
 *
 * ## Bounded, widening read
 *
 * Starts from a small window and doubles only while the streak is still
 * unresolved (`complete: false`), so the common case — a user with a short
 * streak — pays for ONE pair of queries, not a 500-day scan on every Home
 * render.
 */

/** First window. Covers every tier boundary up to `blaze` in one read. */
const BASE_LOOKBACK_DAYS = 35;
/**
 * Hard ceiling. Above this the streak is reported as a LOWER BOUND
 * (`complete: false`) rather than scanned further — the number stays honest
 * and the read stays bounded. Chosen to resolve the 500-day tier exactly,
 * with slack for the terminating gap.
 */
const MAX_LOOKBACK_DAYS = dailyActivityLookbackDays(520);

export interface UseDailyActivityStreakInput {
  /** Canonical timezone — `schedule.config.timezone` with a device fallback. */
  timezone: string;
}

export interface UseDailyActivityStreakResult {
  /** `null` until the first successful read; never render a fabricated 0. */
  streak: DailyActivityStreak | null;
  /** Re-runs the read on demand. Callers must invoke it after a workout or a food entry. */
  reload: () => Promise<DailyActivityStreak | null>;
}

async function readActivityDays(
  uid: string, settings: StreakSettings, todayLocalDate: LocalDate, lookbackDays: number,
): Promise<Set<LocalDate>> {
  const fromLocalDate = addDaysLocal(todayLocalDate, -lookbackDays);

  const [workout, nutrition] = await Promise.all([
    listCompletedWorkoutActivityDatesInRange(uid, fromLocalDate, todayLocalDate),
    listNutritionActivityDays({
      uid,
      fromLocalDate,
      timezone: settings.timezone,
      evidenceFrom: settings.nutritionEvidenceFrom,
    }),
  ]);

  // Union of the two independent sources: a day with a workout AND three
  // meals is still one day — and deleting that day's last food never drops
  // it while the workout stands, because the workout side is append-only.
  return unionActivityDays(workout.performedDates as LocalDate[], nutrition);
}

export function useDailyActivityStreak(
  input: UseDailyActivityStreakInput,
): UseDailyActivityStreakResult {
  const { user } = useAuth();
  const uid = user?.uid ?? null;
  const [streak, setStreak] = useState<DailyActivityStreak | null>(null);
  const { timezone } = input;

  const load = useCallback(async (): Promise<DailyActivityStreak | null> => {
    if (!uid) {
      setStreak(null);
      return null;
    }
    try {
      // The canonical zone wins over whatever the caller resolved: `timezone`
      // is only the value used to PIN it the very first time (schedule config,
      // device fallback). Once pinned it is immutable, so travelling or
      // editing the training schedule can never re-date past evidence.
      const settings = await ensureStreakTimezone(uid, timezone);
      const todayLocalDate = localDateInTimezone(new Date(), settings.timezone);
      let lookbackDays = BASE_LOOKBACK_DAYS;
      for (;;) {
        const activityDates = await readActivityDays(uid, settings, todayLocalDate, lookbackDays);
        const result = computeDailyActivityStreak({
          todayLocalDate,
          activityDates,
          historyAvailableFromLocalDate: addDaysLocal(todayLocalDate, -lookbackDays),
        });
        if (result.complete || lookbackDays >= MAX_LOOKBACK_DAYS) {
          setStreak(result);
          return result;
        }
        lookbackDays = Math.min(lookbackDays * 2, MAX_LOOKBACK_DAYS);
      }
    } catch {
      // A transient failure must never blank an already-shown real streak.
      return null;
    }
  }, [uid, timezone]);

  useEffect(() => {
    void load();
  }, [load]);

  // The streak must also move when the DAY moves, not only when the user
  // registers something: a user who opens the app after an empty day has to
  // see 0 without touching anything. Re-reading on foreground covers the
  // common case (phone locked overnight); the local-date comparison keeps an
  // app left open across midnight correct too, without any polling.
  const lastReadDateRef = useRef<LocalDate | null>(null);
  useEffect(() => {
    lastReadDateRef.current = localDateInTimezone(new Date(), timezone);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      const now = localDateInTimezone(new Date(), timezone);
      if (now === lastReadDateRef.current) return;
      lastReadDateRef.current = now;
      void load();
    });
    return () => subscription.remove();
  }, [load, timezone]);

  return { streak, reload: load };
}
