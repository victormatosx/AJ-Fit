import { createHash } from 'node:crypto';

import { Timestamp, type Firestore } from 'firebase-admin/firestore';

import type { NotificationDispatchRequest } from './schema';

export type NotificationPreflightResult =
  | { allowed: true }
  | { allowed: false; reason: string };

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
  _now: Timestamp,
): Promise<NotificationPreflightResult> {
  if (request.type === 'EVOLUTION_APPROACHING') {
    return evolutionApproachingPreflight(db, request);
  }
  return { allowed: true };
}
