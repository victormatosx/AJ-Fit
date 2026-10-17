import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import { onDocumentUpdated } from 'firebase-functions/v2/firestore';

import { db as defaultDb } from '../lib/firebaseAdmin';
import { logFunctionError, logInfo } from '../lib/logger';
import { isValidNutritionRolloutConfig, nutritionFlagEnabled } from '../nutrition/shared/nutrition/rolloutCore';
import {
  buildNutritionDailyLogReminder,
  buildNutritionPlanReadyNotification,
  buildNutritionWeeklySummaryNotification,
  type NotificationLocale,
} from './contentPolicy';
import {
  claimDailyProductWindow,
  completeDailyProductWindow,
  releaseDailyProductWindowClaim,
} from './dailyProductRateLimit';
import { dailyLocalClock } from './dailyTime';
import { defaultDependencies as defaultDispatcherDependencies, dispatchNotification } from './dispatcher';
import { runNotificationPreflight } from './notificationPreflight';
import {
  readNutritionNotificationContext,
  type NutritionNotificationCandidate,
  type NutritionNotificationContext,
} from './nutritionNotificationContext';
import { resolveUserNotificationPolicy } from './preferences';
import type { NotificationDispatchOutcome, NotificationDispatchRequest } from './schema';
import { dispatchUserNotificationCandidate } from './userNotificationDispatch';

const SCOPE = 'notifications.nutrition';
export const EVENT_NOTIFICATION_START_MINUTE = 8 * 60;
export const EVENT_NOTIFICATION_END_MINUTE = 22 * 60;

export type NutritionNotificationEvaluation = {
  status: 'DISPATCHED';
  notificationType: NutritionNotificationCandidate['notificationType'];
  timezone: string;
  localDate: string;
  outcome: NotificationDispatchOutcome['status'];
} | {
  status: 'SUPPRESSED';
  reason: string;
  timezone?: string;
  localDate?: string;
} | {
  status: 'FAILED';
  timezone?: string;
  localDate?: string;
};

export function buildNutritionRequest(
  uid: string,
  candidate: NutritionNotificationCandidate,
  locale: NotificationLocale,
): NotificationDispatchRequest {
  return candidate.notificationType === 'NUTRITION_DAILY_LOG_REMINDER'
    ? buildNutritionDailyLogReminder({ uid, localDate: candidate.localDate, locale })
    : buildNutritionWeeklySummaryNotification({ uid, weekStart: candidate.weekStart, locale });
}

export async function evaluateNutritionNotification(
  uid: string,
  dependencies: {
    db?: Firestore;
    now?: () => Timestamp;
    readContext?: (uid: string, now: Timestamp) => Promise<NutritionNotificationContext>;
    dispatchCandidate?: typeof dispatchUserNotificationCandidate;
    resolvePolicy?: (uid: string) => Promise<{ allowed: boolean; reason: string }>;
    claimProductWindow?: typeof claimDailyProductWindow;
    completeProductWindow?: typeof completeDailyProductWindow;
    releaseProductWindow?: typeof releaseDailyProductWindowClaim;
  } = {},
): Promise<NutritionNotificationEvaluation> {
  const db = dependencies.db ?? defaultDb;
  const now = (dependencies.now ?? Timestamp.now)();
  let timezone: string | undefined;
  let localDate: string | undefined;
  try {
    const context = await (dependencies.readContext
      ? dependencies.readContext(uid, now)
      : readNutritionNotificationContext(db, uid, now));
    timezone = context.timezone;
    localDate = context.localDate;
    if (!context.allowed) return { status: 'SUPPRESSED', reason: context.reason, timezone, localDate };
    const policy = await (dependencies.resolvePolicy
      ? dependencies.resolvePolicy(uid)
      : resolveUserNotificationPolicy({ uid, category: 'NUTRITION' }, db));
    if (!policy.allowed) return { status: 'SUPPRESSED', reason: policy.reason, timezone, localDate };
    const sample = buildNutritionRequest(uid, context.candidate, 'pt-BR');
    const productWindow = await (dependencies.claimProductWindow ?? claimDailyProductWindow)(db, {
      uid,
      localDate: context.localDate,
      request: sample,
    }, now);
    if (productWindow.outcome !== 'CLAIMED') {
      return {
        status: 'SUPPRESSED',
        reason: productWindow.outcome === 'RATE_LIMITED' ? 'PRODUCT_RATE_LIMIT' : 'DAILY_DUPLICATE',
        timezone,
        localDate,
      };
    }
    const outcome = await (dependencies.dispatchCandidate ?? dispatchUserNotificationCandidate)({
      uid,
      category: 'NUTRITION',
      build: (locale) => buildNutritionRequest(uid, context.candidate, locale),
    });
    if (outcome.status === 'SUPPRESSED_BY_PREFERENCE' || outcome.status === 'SUPPRESSED_BY_POLICY') {
      await (dependencies.releaseProductWindow ?? releaseDailyProductWindowClaim)(db, productWindow);
      return { status: 'SUPPRESSED', reason: outcome.status, timezone, localDate };
    }
    await (dependencies.completeProductWindow ?? completeDailyProductWindow)(db, {
      windowId: productWindow.windowId,
      claimToken: productWindow.claimToken,
      outcome: outcome.status,
    }, now);
    return {
      status: 'DISPATCHED',
      notificationType: context.candidate.notificationType,
      timezone: context.timezone,
      localDate: context.localDate,
      outcome: outcome.status,
    };
  } catch (error) {
    logFunctionError(SCOPE, error, { operation: 'evaluate', timezone, localDate });
    return { status: 'FAILED', timezone, localDate };
  }
}

export async function dispatchNutritionPlanReady(
  uid: string,
  generationId: string,
  db: Firestore = defaultDb,
  now: Timestamp = Timestamp.now(),
): Promise<NotificationDispatchOutcome | null> {
  const root = db.collection('users').doc(uid);
  const [policy, schedule, job, plan, rollout] = await Promise.all([
    resolveUserNotificationPolicy({ uid, category: 'NUTRITION' }, db),
    root.collection('workoutProgramState').doc('scheduleConfig').get(),
    root.collection('nutritionGenerationJobs').doc(generationId).get(),
    root.collection('nutritionPlans').doc(generationId).get(),
    db.collection('nutritionRolloutConfig').doc('active').get(),
  ]);
  const config = rollout.data();
  if (!policy.allowed || !isValidNutritionRolloutConfig(config)
    || !nutritionFlagEnabled(uid, 'nutritionEnabled', config)
    || job.get('status') !== 'completed' || job.get('planId') !== generationId
    || !plan.exists || plan.get('status') !== 'active' || plan.get('generationId') !== generationId) {
    return null;
  }
  const clock = dailyLocalClock(now.toDate(), schedule.data()?.timezone);
  if (!clock) return null;
  const request = buildNutritionPlanReadyNotification({
    uid,
    generationId,
    initialOnboarding: job.get('initialOnboarding') === true,
    locale: policy.locale,
  });
  return dispatchNotification(request, {
    ...defaultDispatcherDependencies(),
    db,
    now: () => now,
    preflight: (candidate, instant) => runNotificationPreflight(db, candidate, instant),
    eligibility: (candidate) => resolveUserNotificationPolicy({
      uid: candidate.uid, category: candidate.category, type: candidate.type,
    }, db),
  });
}

export const onNutritionGenerationCompleted = onDocumentUpdated(
  { document: 'users/{uid}/nutritionGenerationJobs/{generationId}', retry: true },
  async (event) => {
    if (event.data?.before.get('status') === 'completed'
      || event.data?.after.get('status') !== 'completed') return;
    const { uid, generationId } = event.params;
    const outcome = await dispatchNutritionPlanReady(uid, generationId);
    logInfo(SCOPE, 'plan_ready_outcome', {
      generationId,
      outcome: outcome?.status ?? 'SUPPRESSED',
    });
  },
);
