import { FieldPath, Timestamp, type Firestore } from 'firebase-admin/firestore';

import { addDaysLocal, type LocalDate } from '../workoutLifecycle/scheduleEngine/calendar';
import { canonicalIanaTimezone } from '../workoutLifecycle/scheduleEngine/localDate';
import {
  isValidNutritionRolloutConfig,
  nutritionFlagEnabled,
} from '../nutrition/shared/nutrition/rolloutCore';
import { dailyLocalClock } from './dailyTime';

export type NutritionNotificationCandidate =
  | { notificationType: 'NUTRITION_DAILY_LOG_REMINDER'; localDate: string }
  | { notificationType: 'NUTRITION_WEEKLY_SUMMARY'; weekStart: string };

export type NutritionNotificationContext = {
  allowed: true;
  candidate: NutritionNotificationCandidate;
  timezone: string;
  localDate: string;
} | {
  allowed: false;
  reason: string;
  timezone?: string;
  localDate?: string;
};

function mondayFor(localDate: LocalDate): LocalDate {
  const [year, month, day] = localDate.split('-').map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return addDaysLocal(localDate, -((weekday + 6) % 7));
}

// `meals`/`items` live in subcollections now, not as a nested array on the
// day doc (round brief part 1 §6 — Rules' 1000-expression write budget).
// `loggedItemCount` is the client-maintained aggregate that keeps this
// cheap: one field read instead of listing every meal/item subcollection.
function hasLoggedMeal(data: FirebaseFirestore.DocumentData | undefined): boolean {
  return typeof data?.loggedItemCount === 'number' && data.loggedItemCount > 0;
}

export async function readNutritionNotificationContext(
  db: Firestore,
  uid: string,
  now: Timestamp,
  options: { requireDailyWindow?: boolean } = {},
): Promise<NutritionNotificationContext> {
  const root = db.collection('users').doc(uid);
  const [user, lock, scheduleConfig, rollout, activePlans] = await Promise.all([
    root.get(),
    db.collection('accountDeletionLocks').doc(uid).get(),
    root.collection('workoutProgramState').doc('scheduleConfig').get(),
    db.collection('nutritionRolloutConfig').doc('active').get(),
    root.collection('nutritionPlans').where('status', '==', 'active').limit(2).get(),
  ]);
  if (!user.exists) return { allowed: false, reason: 'USER_NOT_FOUND' };
  if (lock.exists) return { allowed: false, reason: 'ACCOUNT_INACTIVE' };
  const config = rollout.data();
  if (!isValidNutritionRolloutConfig(config)
    || !nutritionFlagEnabled(uid, 'nutritionEnabled', config)) {
    return { allowed: false, reason: 'NUTRITION_DISABLED' };
  }
  if (activePlans.size !== 1) return { allowed: false, reason: 'NO_ACTIVE_PLAN' };

  const timezone = canonicalIanaTimezone(scheduleConfig.data()?.timezone);
  if (!timezone) return { allowed: false, reason: 'TIMEZONE_UNAVAILABLE' };
  const clock = dailyLocalClock(now.toDate(), timezone);
  if (!clock) return { allowed: false, reason: 'TIMEZONE_UNAVAILABLE' };
  if ((options.requireDailyWindow ?? true) && !clock.withinWindow) {
    return {
      allowed: false,
      reason: 'OUTSIDE_LOCAL_WINDOW',
      timezone: clock.timezone,
      localDate: clock.localDate,
    };
  }

  const thisMonday = mondayFor(clock.localDate);
  if (clock.localDate === thisMonday) {
    const weekStart = addDaysLocal(thisMonday, -7);
    const weekEnd = addDaysLocal(thisMonday, -1);
    const logs = await root.collection('nutritionDailyLogs')
      .where(FieldPath.documentId(), '>=', weekStart)
      .where(FieldPath.documentId(), '<=', weekEnd)
      .orderBy(FieldPath.documentId())
      .limit(7)
      .get();
    if (logs.docs.some((document) => hasLoggedMeal(document.data()))) {
      return {
        allowed: true,
        candidate: { notificationType: 'NUTRITION_WEEKLY_SUMMARY', weekStart },
        timezone: clock.timezone,
        localDate: clock.localDate,
      };
    }
  }

  const today = await root.collection('nutritionDailyLogs').doc(clock.localDate).get();
  if (today.exists && hasLoggedMeal(today.data())) {
    return {
      allowed: false,
      reason: 'DAILY_LOG_ALREADY_EXISTS',
      timezone: clock.timezone,
      localDate: clock.localDate,
    };
  }
  return {
    allowed: true,
    candidate: { notificationType: 'NUTRITION_DAILY_LOG_REMINDER', localDate: clock.localDate },
    timezone: clock.timezone,
    localDate: clock.localDate,
  };
}
