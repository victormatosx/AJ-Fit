import type { Firestore } from 'firebase-admin/firestore';

import { db as defaultDb } from '../lib/firebaseAdmin';
import type { NotificationCategory } from './schema';

export const NOTIFICATION_PREFERENCE_CATEGORIES = [
  'WORKOUTS_AND_REMINDERS',
  'EVOLUTION_AND_ACHIEVEMENTS',
  'PROGRESS',
  'OPERATIONAL',
] as const satisfies readonly NotificationCategory[];

export type TogglableNotificationCategory = Exclude<NotificationCategory, 'OPERATIONAL'>;

export const NOTIFICATION_PREFERENCE_FIELDS: Readonly<
  Record<TogglableNotificationCategory, string>
> = {
  WORKOUTS_AND_REMINDERS: 'workoutsAndReminders',
  EVOLUTION_AND_ACHIEVEMENTS: 'evolutionAndAchievements',
  PROGRESS: 'progress',
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
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readToggle(
  preferences: unknown,
  category: TogglableNotificationCategory,
): boolean {
  if (!isRecord(preferences)) return true;
  const notificationPreferences = preferences.notificationPreferences;
  if (!isRecord(notificationPreferences)) return true;
  const value = notificationPreferences[NOTIFICATION_PREFERENCE_FIELDS[category]];
  return typeof value === 'boolean' ? value : true;
}

export async function resolveNotificationEligibility(
  params: { uid: string; category: NotificationCategory },
  db: Firestore = defaultDb,
): Promise<NotificationEligibilityResult> {
  const [user, deletionLock] = await Promise.all([
    db.collection('users').doc(params.uid).get(),
    db.collection('accountDeletionLocks').doc(params.uid).get(),
  ]);
  if (!user.exists) return { allowed: false, reason: 'USER_NOT_FOUND' };
  if (deletionLock.exists) return { allowed: false, reason: 'ACCOUNT_INACTIVE' };
  if (params.category === 'OPERATIONAL') return { allowed: true, reason: 'ALLOWED' };

  const allowed = readToggle(user.data()?.preferences, params.category);
  return allowed
    ? { allowed: true, reason: 'ALLOWED' }
    : { allowed: false, reason: 'DISABLED_BY_USER' };
}
