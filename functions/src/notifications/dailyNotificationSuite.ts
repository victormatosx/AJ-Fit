import { evaluateEvolutionApproaching } from './evolutionApproachingNotification';
import { evaluateDailyWorkoutNotification } from './dailyWorkoutNotifications';
import { evaluateReEngagementNotification } from './reengagementNotification';
import { evaluateProgressNotification } from './progressNotification';

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
}

const defaultDependencies: DailyNotificationSuiteDependencies = {
  evaluateWorkout: evaluateDailyWorkoutNotification,
  evaluateApproaching: evaluateEvolutionApproaching,
  evaluateReEngagement: evaluateReEngagementNotification,
  evaluateProgress: evaluateProgressNotification,
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

  const [workout, approaching] = await Promise.all([
    dependencies.evaluateWorkout(uid),
    dependencies.evaluateApproaching(uid),
  ]);
  const timezone = workout.timezone ?? approaching.timezone;
  const localDate = workout.localDate ?? approaching.localDate;
  if (workout.status === 'FAILED' || approaching.status === 'FAILED') {
    return { status: 'FAILED', timezone, localDate };
  }
  if (workout.status === 'DISPATCHED' || approaching.status === 'DISPATCHED') {
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
      + `|WORKOUT:${workout.reason}|APPROACHING:${approaching.reason}`
      + `|PROGRESS:${progress.reason}`,
    timezone: resolvedTimezone,
    localDate: resolvedLocalDate,
  };
}
