import { createHash, randomUUID } from 'node:crypto';

import { Timestamp, type Firestore } from 'firebase-admin/firestore';

import type { NotificationDispatchRequest } from './schema';

export const DAILY_PRODUCT_WINDOWS_COLLECTION = 'notificationProductWindows';
const CLAIM_STALE_AFTER_MS = 15 * 60 * 1000;
const RETENTION_MS = 14 * 24 * 60 * 60 * 1000;

export type DailyProductWindowClaim =
  | { outcome: 'CLAIMED'; windowId: string; claimToken: string }
  | { outcome: 'DUPLICATE' | 'RATE_LIMITED'; windowId: string };

function windowIdFor(uid: string, localDate: string): string {
  return createHash('sha256')
    .update(`${uid}:WORKOUTS_AND_REMINDERS:${localDate}`, 'utf8')
    .digest('hex');
}

export async function claimDailyProductWindow(
  db: Firestore,
  input: {
    uid: string;
    localDate: string;
    request: NotificationDispatchRequest;
  },
  now: Timestamp,
): Promise<DailyProductWindowClaim> {
  const windowId = windowIdFor(input.uid, input.localDate);
  const ref = db.collection(DAILY_PRODUCT_WINDOWS_COLLECTION).doc(windowId);
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const data = snapshot.data();
    const sameSemanticCandidate = data?.uid === input.uid
      && data?.localDate === input.localDate
      && data?.type === input.request.type
      && data?.sourceIdentity === input.request.sourceIdentity;

    if (snapshot.exists && !sameSemanticCandidate) {
      return { outcome: 'RATE_LIMITED' as const, windowId };
    }
    if (snapshot.exists && data?.status === 'COMPLETED') {
      return { outcome: 'DUPLICATE' as const, windowId };
    }
    if (snapshot.exists && data?.status === 'CLAIMED') {
      const updatedAt = data.updatedAt as Timestamp | undefined;
      if (updatedAt && now.toMillis() - updatedAt.toMillis() <= CLAIM_STALE_AFTER_MS) {
        return { outcome: 'DUPLICATE' as const, windowId };
      }
    }

    const claimToken = randomUUID();
    transaction.set(ref, {
      uid: input.uid,
      // The document id intentionally keeps its original opaque namespace so
      // existing workout windows retain their identity. The slot itself is a
      // shared one-per-user/day product guard across engagement categories.
      category: input.request.category,
      localDate: input.localDate,
      type: input.request.type,
      sourceIdentity: input.request.sourceIdentity,
      status: 'CLAIMED',
      claimToken,
      claimVersion: typeof data?.claimVersion === 'number' ? data.claimVersion + 1 : 1,
      createdAt: data?.createdAt instanceof Timestamp ? data.createdAt : now,
      updatedAt: now,
      expireAt: Timestamp.fromMillis(now.toMillis() + RETENTION_MS),
    });
    return { outcome: 'CLAIMED' as const, windowId, claimToken };
  });
}

export async function completeDailyProductWindow(
  db: Firestore,
  input: { windowId: string; claimToken: string; outcome: string },
  now: Timestamp,
): Promise<boolean> {
  const ref = db.collection(DAILY_PRODUCT_WINDOWS_COLLECTION).doc(input.windowId);
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
