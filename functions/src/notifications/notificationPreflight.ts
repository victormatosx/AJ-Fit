import { createHash } from 'node:crypto';

import { Timestamp, type Firestore } from 'firebase-admin/firestore';

import {
  buildAssessmentReminderNotification,
  buildCompareProgressNotification,
  buildPhotoReminderNotification,
  buildReEngagementEarlyNotification,
  buildReEngagementLateNotification,
  buildWeekCompletedNotification,
  buildWeekStreakNotification,
} from './contentPolicy';
import { readProgressNotificationContext } from './progressNotificationContext';
import { readReEngagementContext } from './reengagementContext';
import { readWeeklyAchievementContext } from './weeklyAchievementContext';
import type { NotificationDispatchRequest } from './schema';

export type NotificationPreflightResult =
  | { allowed: true }
  | { allowed: false; reason: string; defer?: boolean };

const TERMINAL_EVOLUTION_EVENTS = new Set([
  'EVOLUTION_EARNED',
  'MOTIVATIONAL_RENEWAL_OFFERED',
]);

/** Re-checks only mutable collision facts, not the original time window. */
async function evolutionApproachingPreflight(
  db: Firestore,
  request: NotificationDispatchRequest,
): Promise<NotificationPreflightResult> {
  return db.runTransaction(async (transaction) => {
    const root = db.collection('users').doc(request.uid);
    const [user, lock, lifecycle, pending] = await Promise.all([
      transaction.get(root),
      transaction.get(db.collection('accountDeletionLocks').doc(request.uid)),
      transaction.get(root.collection('workoutLifecycleState').doc('current')),
      transaction.get(root.collection('pendingEvolutions').doc('current')),
    ]);
    if (!user.exists) return { allowed: false, reason: 'USER_NOT_FOUND' };
    if (lock.exists) return { allowed: false, reason: 'ACCOUNT_INACTIVE' };
    const programInstanceId = lifecycle.data()?.activeProgramInstanceId;
    if (typeof programInstanceId !== 'string') {
      return { allowed: false, reason: 'PROGRESSION_WINDOW_UNAVAILABLE' };
    }
    if (pending.exists) {
      const pendingSource = pending.data()?.sourceProgramInstanceId;
      if (typeof pendingSource !== 'string' || pendingSource === programInstanceId) {
        return { allowed: false, reason: 'EVOLUTION_UNLOCKED_PRIORITY' };
      }
    }
    const sourceIdentity = `progressionWindow:${createHash('sha256').update(programInstanceId).digest('hex')}`;
    if (request.sourceIdentity !== sourceIdentity) {
      return { allowed: false, reason: 'PROGRESSION_WINDOW_CHANGED' };
    }
    const events = await transaction.get(root.collection('workoutLifecycleEvents')
      .where('programInstanceId', '==', programInstanceId).limit(128));
    if (events.docs.some((event) => TERMINAL_EVOLUTION_EVENTS.has(String(event.data().type)))) {
      return { allowed: false, reason: 'EVOLUTION_UNLOCKED_PRIORITY' };
    }
    return { allowed: true };
  });
}

export async function runNotificationPreflight(
  db: Firestore,
  request: NotificationDispatchRequest,
  now: Timestamp,
): Promise<NotificationPreflightResult> {
  if (request.type === 'CAMPAIGN') {
    const campaignId = request.data?.campaignId;
    const campaignRunId = request.data?.campaignRunId;
    if (typeof campaignId !== 'string' || typeof campaignRunId !== 'string') return { allowed: false, reason: 'CAMPAIGN_INVALID' };
    const [campaign, run] = await Promise.all([
      db.collection('notificationCampaigns').doc(campaignId).get(),
      db.collection('notificationCampaigns').doc(campaignId).collection('runs').doc(campaignRunId).get(),
    ]);
    if (!campaign.exists || campaign.get('status') === 'canceled' || !run.exists || run.get('status') === 'canceled') return { allowed: false, reason: 'CAMPAIGN_CANCELED' };
    if (campaign.get('status') === 'paused') return { allowed: false, reason: 'CAMPAIGN_PAUSED', defer: true };
    return { allowed: true };
  }
  if (
    request.type === 'WORKOUT_DAY'
    || request.type === 'RECOVERY_DAY'
    || request.type === 'MISSED_WORKOUT'
  ) {
    // Dynamic import avoids a module-initialization cycle: the evaluator's
    // normal dispatch path reaches dispatcher -> this preflight module.
    const { preflightDailyWorkoutNotification } = await import('./dailyWorkoutNotifications');
    return preflightDailyWorkoutNotification(db, request, now);
  }
  if (request.type === 'EVOLUTION_APPROACHING') {
    return evolutionApproachingPreflight(db, request);
  }
  if (request.type === 'RE_ENGAGEMENT_EARLY' || request.type === 'RE_ENGAGEMENT_LATE') {
    const context = await readReEngagementContext(
      db,
      request.uid,
      now,
      {},
      { requireDailyWindow: false },
    );
    if (!context.allowed) return { allowed: false, reason: context.reason };
    if (context.notificationType !== request.type) {
      return { allowed: false, reason: 'REENGAGEMENT_STAGE_CHANGED' };
    }
    const rebuilt = request.type === 'RE_ENGAGEMENT_EARLY'
      ? buildReEngagementEarlyNotification({
          uid: request.uid,
          episodeIdentity: context.episodeIdentity,
          locale: 'pt-BR',
        })
      : buildReEngagementLateNotification({
          uid: request.uid,
          episodeIdentity: context.episodeIdentity,
          locale: 'pt-BR',
        });
    if (rebuilt.sourceIdentity !== request.sourceIdentity) {
      return { allowed: false, reason: 'REENGAGEMENT_EPISODE_CHANGED' };
    }
  }
  if (
    request.type === 'PHOTO_REMINDER'
    || request.type === 'ASSESSMENT_REMINDER'
    || request.type === 'COMPARE_PROGRESS'
  ) {
    const context = await readProgressNotificationContext(
      db,
      request.uid,
      now,
      {},
      { requireDailyWindow: false },
    );
    if (!context.allowed) {
      return {
        allowed: false,
        reason: context.reason === 'NO_PROGRESS_CANDIDATE'
          ? 'PROGRESS_FACT_CHANGED'
          : context.reason,
      };
    }
    const remainsValid = context.candidates.some((candidate) => {
      if (candidate.notificationType !== request.type) return false;
      const params = {
        uid: request.uid,
        progressIdentity: candidate.progressIdentity,
        locale: 'pt-BR' as const,
      };
      const rebuilt = candidate.notificationType === 'PHOTO_REMINDER'
        ? buildPhotoReminderNotification(params)
        : candidate.notificationType === 'ASSESSMENT_REMINDER'
          ? buildAssessmentReminderNotification(params)
          : buildCompareProgressNotification(params);
      return rebuilt.sourceIdentity === request.sourceIdentity;
    });
    if (!remainsValid) return { allowed: false, reason: 'PROGRESS_FACT_CHANGED' };
  }
  if (request.type === 'WEEK_COMPLETED' || request.type === 'WEEK_STREAK') {
    const context = await readWeeklyAchievementContext(db, request.uid, now, { requireDailyWindow: false });
    if (!context.allowed) return { allowed: false, reason: context.reason };
    if (context.candidate.notificationType !== request.type) {
      return { allowed: false, reason: 'WEEKLY_ACHIEVEMENT_PRIORITY_CHANGED' };
    }
    const rebuilt = context.candidate.notificationType === 'WEEK_STREAK'
      ? buildWeekStreakNotification({
          uid: request.uid,
          achievementIdentity: context.candidate.achievementIdentity,
          locale: 'pt-BR',
          weeks: context.candidate.weeks,
        })
      : buildWeekCompletedNotification({
          uid: request.uid,
          achievementIdentity: context.candidate.achievementIdentity,
          locale: 'pt-BR',
        });
    if (rebuilt.sourceIdentity !== request.sourceIdentity) {
      return { allowed: false, reason: 'PERFECT_WEEK_FACT_CHANGED' };
    }
  }
  return { allowed: true };
}
