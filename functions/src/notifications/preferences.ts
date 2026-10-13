import type { Firestore } from 'firebase-admin/firestore';

import { db as defaultDb } from '../lib/firebaseAdmin';
import {
  NOTIFICATION_LOCALES,
  type NotificationLocale,
} from './contentPolicy';
import type { NotificationCategory, NotificationType } from './schema';

export const NOTIFICATION_PREFERENCE_CATEGORIES = [
  'WORKOUTS_AND_REMINDERS',
  'EVOLUTION_AND_ACHIEVEMENTS',
  'PROGRESS',
  'NUTRITION',
  'OPERATIONAL',
] as const satisfies readonly NotificationCategory[];

export type TogglableNotificationCategory = Exclude<NotificationCategory, 'OPERATIONAL'>;

export const NOTIFICATION_PREFERENCE_FIELDS: Readonly<
  Record<TogglableNotificationCategory, string>
> = {
  WORKOUTS_AND_REMINDERS: 'workoutsAndReminders',
  EVOLUTION_AND_ACHIEVEMENTS: 'evolutionAndAchievements',
  PROGRESS: 'progress',
  NUTRITION: 'nutrition',
};

/** Keep the persisted OPERATIONAL dispatch category for historical idempotency hashes. */
export const OPERATIONAL_TYPE_PREFERENCE_FIELDS: Readonly<Partial<Record<NotificationType, string>>> = {
  BILLING_ISSUE: 'subscription',
  PREMIUM_ENDED: 'subscription',
  SUPPORT_SINGLE_REPLY: 'support',
  SUPPORT_CHAT_MESSAGE: 'support',
};

export type NotificationEligibilityReason =
  | 'ALLOWED'
  | 'DISABLED_BY_USER'
  | 'USER_NOT_FOUND'
  | 'ACCOUNT_INACTIVE';

export interface NotificationEligibilityResult {
  allowed: boolean;
  reason: NotificationEligibilityReason;
}

export interface UserNotificationPolicyResult extends NotificationEligibilityResult {
  locale: NotificationLocale;
}

export type QaPreviewNotificationPolicyResult = UserNotificationPolicyResult;
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readToggle(
  preferences: unknown,
  field: string,
): boolean {
  if (!isRecord(preferences)) return true;
  const notificationPreferences = preferences.notificationPreferences;
  if (!isRecord(notificationPreferences)) return true;
  const value = notificationPreferences[field];
  return typeof value === 'boolean' ? value : true;
}

export async function resolveNotificationEligibility(
  params: { uid: string; category: NotificationCategory; type?: NotificationType },
  db: Firestore = defaultDb,
): Promise<NotificationEligibilityResult> {
  const { locale: _locale, ...eligibility } = await resolveUserNotificationPolicy(params, db);
  return eligibility;
}

export async function resolveUserNotificationPolicy(
  params: { uid: string; category: NotificationCategory; type?: NotificationType },
  db: Firestore = defaultDb,
): Promise<UserNotificationPolicyResult> {
  const [user, deletionLock] = await Promise.all([
    db.collection('users').doc(params.uid).get(),
    db.collection('accountDeletionLocks').doc(params.uid).get(),
  ]);
  const language = user.data()?.preferences?.language;
  const locale: NotificationLocale =
    typeof language === 'string' && (NOTIFICATION_LOCALES as readonly string[]).includes(language)
      ? language as NotificationLocale
      : 'pt-BR';
  if (!user.exists) return { allowed: false, reason: 'USER_NOT_FOUND', locale };
  if (deletionLock.exists) return { allowed: false, reason: 'ACCOUNT_INACTIVE', locale };
  const field = params.category === 'OPERATIONAL'
    ? (params.type ? OPERATIONAL_TYPE_PREFERENCE_FIELDS[params.type] : undefined)
    : NOTIFICATION_PREFERENCE_FIELDS[params.category];
  if (!field) {
    return { allowed: true, reason: 'ALLOWED', locale };
  }

  const allowed = readToggle(user.data()?.preferences, field);
  return allowed
    ? { allowed: true, reason: 'ALLOWED', locale }
    : { allowed: false, reason: 'DISABLED_BY_USER', locale };
}

/**
 * Manual QA is an explicit user action, so product-category toggles do not
 * suppress it. Account existence/deletion and locale still come from the
 * same authoritative profile reads used by product notification policy.
 */
export async function resolveQaPreviewNotificationPolicy(
  uid: string,
  db: Firestore = defaultDb,
): Promise<QaPreviewNotificationPolicyResult> {
  const [user, deletionLock] = await Promise.all([
    db.collection('users').doc(uid).get(),
    db.collection('accountDeletionLocks').doc(uid).get(),
  ]);
  const language = user.data()?.preferences?.language;
  const locale: NotificationLocale =
    typeof language === 'string' && (NOTIFICATION_LOCALES as readonly string[]).includes(language)
      ? language as NotificationLocale
      : 'pt-BR';
  if (!user.exists) return { allowed: false, reason: 'USER_NOT_FOUND', locale };
  if (deletionLock.exists) return { allowed: false, reason: 'ACCOUNT_INACTIVE', locale };
  return { allowed: true, reason: 'ALLOWED', locale };
}
