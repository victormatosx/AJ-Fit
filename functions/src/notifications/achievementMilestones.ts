import { createHash, randomUUID } from 'node:crypto';

import { Timestamp, type Firestore } from 'firebase-admin/firestore';

import type { NotificationDispatchRequest } from './schema';

export const NOTIFICATION_ACHIEVEMENT_MILESTONES_COLLECTION = 'notificationAchievementMilestones';
export const ACHIEVEMENT_MILESTONE_CLAIM_STALE_MS = 15 * 60 * 1000;

export type AchievementMilestoneClaim =
  | { outcome: 'CLAIMED'; milestoneId: string; claimToken: string }
  | { outcome: 'DUPLICATE'; milestoneId: string };

function milestoneIdFor(request: NotificationDispatchRequest): string {
  return createHash('sha256')
    .update(`${request.uid}:${request.type}:${request.sourceIdentity}`, 'utf8')
    .digest('hex');
}

/**
 * Durable one-shot fact for a progression milestone. Dispatch documents have
 * a troubleshooting TTL; this tiny backend-only projection intentionally
 * lives until account deletion so that a long-paused progression window
 * cannot reopen.
 */
export async function claimAchievementMilestone(
  db: Firestore,
  request: NotificationDispatchRequest,
  now: Timestamp,
): Promise<AchievementMilestoneClaim> {
  const milestoneId = milestoneIdFor(request);
  const ref = db.collection(NOTIFICATION_ACHIEVEMENT_MILESTONES_COLLECTION).doc(milestoneId);
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const data = snapshot.data();
    const sameContract = data?.uid === request.uid
      && data?.type === request.type
      && data?.sourceIdentity === request.sourceIdentity;
    if (snapshot.exists && !sameContract) throw new Error('achievement_milestone_contract_conflict');
    if (data?.status === 'COMPLETED') return { outcome: 'DUPLICATE' as const, milestoneId };
    if (data?.status === 'CLAIMED' && data.updatedAt instanceof Timestamp
      && now.toMillis() - data.updatedAt.toMillis() <= ACHIEVEMENT_MILESTONE_CLAIM_STALE_MS) {
      return { outcome: 'DUPLICATE' as const, milestoneId };
    }

    const claimToken = randomUUID();
    transaction.set(ref, {
      uid: request.uid,
      category: request.category,
      type: request.type,
      sourceIdentity: request.sourceIdentity,
      status: 'CLAIMED',
      claimToken,
      claimVersion: typeof data?.claimVersion === 'number' ? data.claimVersion + 1 : 1,
      createdAt: data?.createdAt instanceof Timestamp ? data.createdAt : now,
      updatedAt: now,
    });
    return { outcome: 'CLAIMED' as const, milestoneId, claimToken };
  });
}

export async function completeAchievementMilestone(
  db: Firestore,
  input: { milestoneId: string; claimToken: string; outcome: string },
  now: Timestamp,
): Promise<boolean> {
  const ref = db.collection(NOTIFICATION_ACHIEVEMENT_MILESTONES_COLLECTION).doc(input.milestoneId);
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (snapshot.data()?.status !== 'CLAIMED' || snapshot.data()?.claimToken !== input.claimToken) {
      return false;
    }
    transaction.update(ref, {
      status: 'COMPLETED',
      claimToken: null,
      outcome: input.outcome,
      updatedAt: now,
    });
    return true;
  });
}

/** Releases only the caller's still-current claim when no dispatch occurred. */
export async function releaseAchievementMilestoneClaim(
  db: Firestore,
  input: { milestoneId: string; claimToken: string },
): Promise<boolean> {
  const ref = db.collection(NOTIFICATION_ACHIEVEMENT_MILESTONES_COLLECTION).doc(input.milestoneId);
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (snapshot.data()?.status !== 'CLAIMED' || snapshot.data()?.claimToken !== input.claimToken) {
      return false;
    }
    transaction.delete(ref);
    return true;
  });
}
