import { evaluateEvolutionApproaching } from './evolutionApproachingNotification';
import { evaluateDailyWorkoutNotification } from './dailyWorkoutNotifications';

export interface DailyNotificationSuiteResult {
  status: 'DISPATCHED' | 'SUPPRESSED' | 'FAILED';
  reason?: string;
  timezone?: string;
  localDate?: string;
}

export interface DailyNotificationSuiteDependencies {
  evaluateWorkout(uid: string): ReturnType<typeof evaluateDailyWorkoutNotification>;
  evaluateApproaching(uid: string): ReturnType<typeof evaluateEvolutionApproaching>;
}

const defaultDependencies: DailyNotificationSuiteDependencies = {
  evaluateWorkout: evaluateDailyWorkoutNotification,
  evaluateApproaching: evaluateEvolutionApproaching,
};

/** One scheduler claim evaluates both independent product observers. */
export async function evaluateDailyNotificationSuite(
  uid: string,
  dependencies: DailyNotificationSuiteDependencies = defaultDependencies,
): Promise<DailyNotificationSuiteResult> {
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
    reason: `WORKOUT:${workout.reason}|APPROACHING:${approaching.reason}`,
    timezone,
    localDate,
  };
}
