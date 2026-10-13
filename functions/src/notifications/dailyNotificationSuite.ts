import { evaluateEvolutionApproaching } from './evolutionApproachingNotification';
import { evaluateDailyWorkoutNotification } from './dailyWorkoutNotifications';
import { evaluateReEngagementNotification } from './reengagementNotification';
import { evaluateProgressNotification } from './progressNotification';
import { evaluateWeeklyAchievementNotification } from './weeklyAchievementNotification';
import { evaluateNutritionNotification } from './nutritionNotifications';

interface DailyNotificationSuiteResultContext {
  timezone?: string;
  localDate?: string;
}

export type DailyNotificationSuiteResult = DailyNotificationSuiteResultContext & (
  | { status: 'DISPATCHED'; reason?: never; terminalCondition?: never }
  | {
      status: 'SUPPRESSED';
      reason: string;
      /**
       * Structured cleanup signal for the scheduler. Diagnostic `reason`
       * strings may be composed and must never be parsed to make destructive
       * decisions. The scheduler still verifies `users/{uid}` transactionally
       * before delete.
       */
      terminalCondition?: 'USER_NOT_FOUND';
    }
  | { status: 'FAILED'; reason?: never; terminalCondition?: never }
);

export interface DailyNotificationSuiteDependencies {
  evaluateWorkout(uid: string): ReturnType<typeof evaluateDailyWorkoutNotification>;
  evaluateApproaching(uid: string): ReturnType<typeof evaluateEvolutionApproaching>;
  evaluateReEngagement(uid: string): ReturnType<typeof evaluateReEngagementNotification>;
  evaluateProgress(uid: string): ReturnType<typeof evaluateProgressNotification>;
  evaluateWeeklyAchievement(uid: string): ReturnType<typeof evaluateWeeklyAchievementNotification>;
  evaluateNutrition?(uid: string): ReturnType<typeof evaluateNutritionNotification>;
}

const defaultDependencies: DailyNotificationSuiteDependencies = {
  evaluateWorkout: evaluateDailyWorkoutNotification,
  evaluateApproaching: evaluateEvolutionApproaching,
  evaluateReEngagement: evaluateReEngagementNotification,
  evaluateProgress: evaluateProgressNotification,
  evaluateWeeklyAchievement: evaluateWeeklyAchievementNotification,
  evaluateNutrition: evaluateNutritionNotification,
};

function reportsUserNotFound(
  result: { status: string; reason?: string },
): boolean {
  return result.status === 'SUPPRESSED' && result.reason === 'USER_NOT_FOUND';
}

/** One scheduler claim evaluates the ordered daily product observers. */
export async function evaluateDailyNotificationSuite(
  uid: string,
  dependencies: DailyNotificationSuiteDependencies = defaultDependencies,
): Promise<DailyNotificationSuiteResult> {
  const reengagement = await dependencies.evaluateReEngagement(uid);
  if (reengagement.status === 'FAILED') {
    return {
      status: 'FAILED',
      timezone: reengagement.timezone,
      localDate: reengagement.localDate,
    };
  }
  if (reengagement.status === 'DISPATCHED') {
    return {
      status: 'DISPATCHED',
      timezone: reengagement.timezone,
      localDate: reengagement.localDate,
    };
  }
  if (reengagement.blocksLowerPriorityNotifications) {
    return {
      status: 'SUPPRESSED',
      reason: `REENGAGEMENT:${reengagement.reason}`,
      ...(reportsUserNotFound(reengagement) ? { terminalCondition: 'USER_NOT_FOUND' as const } : {}),
      timezone: reengagement.timezone,
      localDate: reengagement.localDate,
    };
  }

  const weeklyAchievement = await dependencies.evaluateWeeklyAchievement(uid);
  if (weeklyAchievement.status === 'FAILED') {
    return {
      status: 'FAILED',
      timezone: weeklyAchievement.timezone,
      localDate: weeklyAchievement.localDate,
    };
  }
  if (weeklyAchievement.status === 'DISPATCHED') {
    return {
      status: 'DISPATCHED',
      timezone: weeklyAchievement.timezone,
      localDate: weeklyAchievement.localDate,
    };
  }

  // Same-tier candidates are evaluated sequentially so the winner consolidates
  // the shared daily product slot before the next one is even derived. Running
  // them concurrently let both cross their own fences and produce two product
  // pushes on the same local day. EVOLUTION_APPROACHING goes first inside the
  // tier because its milestone window is bounded and non-recurring, while the
  // workout candidates recur on every prescribed day.
  const approaching = await dependencies.evaluateApproaching(uid);
  if (approaching.status === 'FAILED') {
    return { status: 'FAILED', timezone: approaching.timezone, localDate: approaching.localDate };
  }
  if (approaching.status === 'DISPATCHED') {
    return {
      status: 'DISPATCHED',
      timezone: approaching.timezone,
      localDate: approaching.localDate,
    };
  }

  const workout = await dependencies.evaluateWorkout(uid);
  const timezone = workout.timezone ?? approaching.timezone;
  const localDate = workout.localDate ?? approaching.localDate;
  if (workout.status === 'FAILED') {
    return { status: 'FAILED', timezone, localDate };
  }
  if (workout.status === 'DISPATCHED') {
    return { status: 'DISPATCHED', timezone, localDate };
  }

  const progress = await dependencies.evaluateProgress(uid);
  const resolvedTimezone = timezone ?? progress.timezone;
  const resolvedLocalDate = localDate ?? progress.localDate;
  if (progress.status === 'FAILED') {
    return { status: 'FAILED', timezone: resolvedTimezone, localDate: resolvedLocalDate };
  }
  if (progress.status === 'DISPATCHED') {
    return { status: 'DISPATCHED', timezone: resolvedTimezone, localDate: resolvedLocalDate };
  }
  const nutrition = await (dependencies.evaluateNutrition?.(uid)
    ?? Promise.resolve({ status: 'SUPPRESSED' as const, reason: 'NOT_EVALUATED',
      timezone: undefined, localDate: undefined }));
  const finalTimezone = resolvedTimezone ?? nutrition.timezone;
  const finalLocalDate = resolvedLocalDate ?? nutrition.localDate;
  if (nutrition.status === 'FAILED') {
    return { status: 'FAILED', timezone: finalTimezone, localDate: finalLocalDate };
  }
  if (nutrition.status === 'DISPATCHED') {
    return { status: 'DISPATCHED', timezone: finalTimezone, localDate: finalLocalDate };
  }
  const terminalCondition = [
    reengagement,
    weeklyAchievement,
    approaching,
    workout,
    progress,
    nutrition,
  ].some(reportsUserNotFound)
    ? 'USER_NOT_FOUND' as const
    : undefined;
  return {
    status: 'SUPPRESSED',
    reason:
      `REENGAGEMENT:${reengagement.reason}`
      + `|WEEKLY_ACHIEVEMENT:${weeklyAchievement.reason}`
      + `|WORKOUT:${workout.reason}|APPROACHING:${approaching.reason}`
      + `|PROGRESS:${progress.reason}`
      + (nutrition.reason === 'NOT_EVALUATED' ? '' : `|NUTRITION:${nutrition.reason}`),
    ...(terminalCondition ? { terminalCondition } : {}),
    timezone: finalTimezone,
    localDate: finalLocalDate,
  };
}
