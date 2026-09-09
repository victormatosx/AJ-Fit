import { Timestamp, type Firestore } from 'firebase-admin/firestore';

import { PROGRESSION_V2_CONFIG } from '../workoutLifecycle/prescriptionEngine/progressionEngineV2/config';
import {
  addDaysLocal,
  compareLocalDates,
  trainingDayOccurrences,
} from '../workoutLifecycle/scheduleEngine/calendar';
import type { Weekday } from '../workoutLifecycle/scheduleEngine/weekday';
import { dailyLocalClock } from './dailyTime';
import {
  loadDailyWorkoutContext,
  type DailyWorkoutContextLoad,
} from './dailyWorkoutNotifications';

export const RE_ENGAGEMENT_EARLY_MISSED_OPPORTUNITIES =
  PROGRESSION_V2_CONFIG.inactivityMissedOpportunityThreshold;
export const RE_ENGAGEMENT_LATE_MISSED_OPPORTUNITIES =
  RE_ENGAGEMENT_EARLY_MISSED_OPPORTUNITIES * 2;

export type ReEngagementNotificationType =
  | 'RE_ENGAGEMENT_EARLY'
  | 'RE_ENGAGEMENT_LATE';

export type ReEngagementContext = {
  allowed: true;
  notificationType: ReEngagementNotificationType;
  episodeIdentity: string;
  missedOpportunityCount: number;
  timezone: string;
  localDate: string;
} | {
  allowed: false;
  reason: string;
  timezone?: string;
  localDate?: string;
};

export type ReEngagementEpisode = {
  allowed: true;
  notificationType: ReEngagementNotificationType;
  episodeIdentity: string;
  missedOpportunityCount: number;
} | {
  allowed: false;
  reason: string;
};

export interface ReEngagementEpisodeInput {
  programInstanceId: string;
  activatedAtLocalDate: string;
  lastCompletedAt: string | null;
  trainingDays: readonly Weekday[];
  todayLocalDate: string;
}

const SAFE_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,160}$/;

/**
 * Derives the current absence episode from the active program's canonical
 * schedule cursor. Today is never considered missed: an opportunity becomes
 * missed only after its local civil date has ended.
 */
export function deriveReEngagementEpisode(
  input: ReEngagementEpisodeInput,
): ReEngagementEpisode {
  if (!SAFE_ID_PATTERN.test(input.programInstanceId)) {
    return { allowed: false, reason: 'PROGRAM_UNAVAILABLE' };
  }
  if (
    input.lastCompletedAt !== null
    && (
      compareLocalDates(input.lastCompletedAt, input.activatedAtLocalDate) < 0
      || compareLocalDates(input.lastCompletedAt, input.todayLocalDate) > 0
    )
  ) {
    return { allowed: false, reason: 'HISTORY_UNAVAILABLE' };
  }

  const yesterday = addDaysLocal(input.todayLocalDate, -1);
  const fromDateExclusive = input.lastCompletedAt
    ?? addDaysLocal(input.activatedAtLocalDate, -1);
  const missedOpportunities = trainingDayOccurrences(
    input.trainingDays,
    fromDateExclusive,
    yesterday,
  );
  if (missedOpportunities.length < RE_ENGAGEMENT_EARLY_MISSED_OPPORTUNITIES) {
    return { allowed: false, reason: 'INSUFFICIENT_MISSED_OPPORTUNITIES' };
  }

  const firstMissedOpportunity = missedOpportunities[0];
  if (!firstMissedOpportunity) {
    return { allowed: false, reason: 'HISTORY_UNAVAILABLE' };
  }
  return {
    allowed: true,
    notificationType:
      missedOpportunities.length >= RE_ENGAGEMENT_LATE_MISSED_OPPORTUNITIES
        ? 'RE_ENGAGEMENT_LATE'
        : 'RE_ENGAGEMENT_EARLY',
    episodeIdentity: `${input.programInstanceId}:${firstMissedOpportunity}`,
    missedOpportunityCount: missedOpportunities.length,
  };
}

export interface ReEngagementContextDependencies {
  loadWorkoutContext(uid: string, instant: Date): Promise<DailyWorkoutContextLoad>;
}

export interface ReEngagementContextOptions {
  /** Scheduler evaluations require 08:00-10:00; dispatch retries do not. */
  requireDailyWindow?: boolean;
}

/** Reads only canonical program/schedule facts; it never writes workout state. */
export async function readReEngagementContext(
  db: Firestore,
  uid: string,
  now: Timestamp,
  overrides: Partial<ReEngagementContextDependencies> = {},
  options: ReEngagementContextOptions = {},
): Promise<ReEngagementContext> {
  const loadWorkoutContext = overrides.loadWorkoutContext
    ?? ((targetUid: string, instant: Date) => loadDailyWorkoutContext(db, targetUid, instant));
  const workout = await loadWorkoutContext(uid, now.toDate());
  if (workout.status !== 'READY') {
    return { allowed: false, reason: workout.status, timezone: workout.timezone };
  }
  const clock = dailyLocalClock(now.toDate(), workout.timezone);
  if (!clock) return { allowed: false, reason: 'TIMEZONE_UNAVAILABLE' };
  if ((options.requireDailyWindow ?? true) && !clock.withinWindow) {
    return {
      allowed: false,
      reason: 'OUTSIDE_LOCAL_WINDOW',
      timezone: clock.timezone,
      localDate: clock.localDate,
    };
  }

  const trainingDays = workout.weeklySchedule
    .filter((day) => day.state === 'TRAINING')
    .map((day) => day.weekday);
  const episode = deriveReEngagementEpisode({
    programInstanceId: workout.programInstanceId,
    activatedAtLocalDate: workout.activatedAtLocalDate,
    lastCompletedAt: workout.scheduleState?.lastCompletedAt ?? null,
    trainingDays,
    todayLocalDate: clock.localDate,
  });
  return { ...episode, timezone: clock.timezone, localDate: clock.localDate };
}
