import { evaluateEvolutionApproaching } from './evolutionApproachingNotification';
import { evaluateDailyWorkoutNotification } from './dailyWorkoutNotifications';
import { evaluateReEngagementNotification } from './reengagementNotification';
import { evaluateProgressNotification } from './progressNotification';
import { evaluateWeeklyAchievementNotification } from './weeklyAchievementNotification';

export interface DailyNotificationSuiteResult {
  status: 'DISPATCHED' | 'SUPPRESSED' | 'FAILED';
  reason?: string;
  timezone?: string;
  localDate?: string;
}

export interface DailyNotificationSuiteDependencies {
  evaluateWorkout(uid: string): ReturnType<typeof evaluateDailyWorkoutNotification>;
  evaluateApproaching(uid: string): ReturnType<typeof evaluateEvolutionApproaching>;
  evaluateReEngagement(uid: string): ReturnType<typeof evaluateReEngagementNotification>;
  evaluateProgress(uid: string): ReturnType<typeof evaluateProgressNotification>;
  evaluateWeeklyAchievement(uid: string): ReturnType<typeof evaluateWeeklyAchievementNotification>;
}

const defaultDependencies: DailyNotificationSuiteDependencies = {
  evaluateWorkout: evaluateDailyWorkoutNotification,
  evaluateApproaching: evaluateEvolutionApproaching,
  evaluateReEngagement: evaluateReEngagementNotification,
  evaluateProgress: evaluateProgressNotification,
  evaluateWeeklyAchievement: evaluateWeeklyAchievementNotification,
};

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
  return {
    status: 'SUPPRESSED',
    reason:
      `REENGAGEMENT:${reengagement.reason}`
      + `|WEEKLY_ACHIEVEMENT:${weeklyAchievement.reason}`
      + `|WORKOUT:${workout.reason}|APPROACHING:${approaching.reason}`
      + `|PROGRESS:${progress.reason}`,
    timezone: resolvedTimezone,
    localDate: resolvedLocalDate,
  };
}
