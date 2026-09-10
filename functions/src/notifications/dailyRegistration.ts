import { Timestamp, type DocumentData, type Firestore, type Transaction } from 'firebase-admin/firestore';

import { nextDailyEvaluationInstant } from './dailyTime';

export const DAILY_NOTIFICATION_USERS_COLLECTION = 'notificationDailyUsers';
export const DAILY_NOTIFICATION_REGISTRATION_TTL_MS = 45 * 24 * 60 * 60 * 1000;
export const DAILY_NOTIFICATION_SCHEMA_VERSION = 1;

export interface DailyNotificationRegistrationWrite {
  timezone: string;
  nextEvaluationAt: Timestamp;
  lastTimezoneSyncAt: Timestamp;
  expireAt: Timestamp;
  schemaVersion: typeof DAILY_NOTIFICATION_SCHEMA_VERSION;
}

export function dailyNotificationRegistrationWrite(input: {
  timezone: string;
  now: Timestamp;
  existing?: DocumentData;
}): DailyNotificationRegistrationWrite | null {
  const due = nextDailyEvaluationInstant(input.now.toDate(), input.timezone);
  if (!due) return null;
  const existingTimezone = typeof input.existing?.timezone === 'string'
    ? input.existing.timezone
    : null;
  const existingDue = input.existing?.nextEvaluationAt instanceof Timestamp
    ? input.existing.nextEvaluationAt as Timestamp
    : null;
  return {
    timezone: input.timezone,
    // A same-zone foreground sync must not move tomorrow's already-evaluated
    // deadline back into today's window. A timezone change recomputes it.
    nextEvaluationAt: existingTimezone === input.timezone && existingDue
      ? existingDue
      : Timestamp.fromDate(due),
    lastTimezoneSyncAt: input.now,
    expireAt: Timestamp.fromMillis(input.now.toMillis() + DAILY_NOTIFICATION_REGISTRATION_TTL_MS),
    schemaVersion: DAILY_NOTIFICATION_SCHEMA_VERSION,
  };
}

export function dailyNotificationRegistrationRef(db: Firestore, uid: string) {
  return db.collection(DAILY_NOTIFICATION_USERS_COLLECTION).doc(uid);
}

export function persistDailyNotificationRegistration(
  transaction: Transaction,
  ref: FirebaseFirestore.DocumentReference,
  write: DailyNotificationRegistrationWrite,
): void {
  transaction.set(ref, write);
}
