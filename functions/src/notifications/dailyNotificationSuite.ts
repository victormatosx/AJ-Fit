import { evaluateEvolutionApproaching } from './evolutionApproachingNotification';
import { evaluateDailyWorkoutNotification } from './dailyWorkoutNotifications';
import { evaluateReEngagementNotification } from './reengagementNotification';

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
}

const defaultDependencies: DailyNotificationSuiteDependencies = {
  evaluateWorkout: evaluateDailyWorkoutNotification,
  evaluateApproaching: evaluateEvolutionApproaching,
  evaluateReEngagement: evaluateReEngagementNotification,
};

/** One scheduler claim evaluates both independent product observers. */
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
  return {
    status: 'SUPPRESSED',
    reason:
      `REENGAGEMENT:${reengagement.reason}`
      + `|WORKOUT:${workout.reason}|APPROACHING:${approaching.reason}`,
    timezone,
    localDate,
  };
}
