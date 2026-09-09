import { Timestamp } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';

import { createFakeFirestore } from '../../accountDeletion/firestoreCleanup/__tests__/fakeFirestore';
import { buildEvolutionApproachingNotification } from '../contentPolicy';
import {
  ACHIEVEMENT_MILESTONE_CLAIM_STALE_MS,
  claimAchievementMilestone,
  completeAchievementMilestone,
} from '../achievementMilestones';

const NOW = Timestamp.fromMillis(2_000_000_000_000);
const REQUEST = buildEvolutionApproachingNotification({
  uid: 'uid-1', progressionWindowId: 'instance-1', locale: 'pt-BR',
});

describe('achievement milestone projection', () => {
  it('claims once, fences completion, and remains a durable duplicate', async () => {
    const db = createFakeFirestore().db as never;
    const first = await claimAchievementMilestone(db, REQUEST, NOW);
    expect(first.outcome).toBe('CLAIMED');
    if (first.outcome !== 'CLAIMED') throw new Error('expected claim');
    await expect(completeAchievementMilestone(db, {
      milestoneId: first.milestoneId, claimToken: 'stale', outcome: 'PENDING_RECEIPTS',
    }, NOW)).resolves.toBe(false);
    await expect(completeAchievementMilestone(db, {
      milestoneId: first.milestoneId, claimToken: first.claimToken, outcome: 'PENDING_RECEIPTS',
    }, NOW)).resolves.toBe(true);
    await expect(claimAchievementMilestone(db, REQUEST, NOW)).resolves.toMatchObject({
      outcome: 'DUPLICATE', milestoneId: first.milestoneId,
    });
  });

  it('reclaims a stale worker and prevents the old worker from overwriting it', async () => {
    const db = createFakeFirestore().db as never;
    const first = await claimAchievementMilestone(db, REQUEST, NOW);
    const later = Timestamp.fromMillis(NOW.toMillis() + ACHIEVEMENT_MILESTONE_CLAIM_STALE_MS + 1);
    const second = await claimAchievementMilestone(db, REQUEST, later);
    expect(first.outcome).toBe('CLAIMED');
    expect(second.outcome).toBe('CLAIMED');
    if (first.outcome !== 'CLAIMED' || second.outcome !== 'CLAIMED') throw new Error('expected claims');
    await expect(completeAchievementMilestone(db, {
      milestoneId: first.milestoneId, claimToken: first.claimToken, outcome: 'STALE',
    }, later)).resolves.toBe(false);
    await expect(completeAchievementMilestone(db, {
      milestoneId: second.milestoneId, claimToken: second.claimToken, outcome: 'CONFIRMED',
    }, later)).resolves.toBe(true);
  });

  it('permits a different cycle without reopening the prior milestone', async () => {
    const db = createFakeFirestore().db as never;
    const next = buildEvolutionApproachingNotification({
      uid: 'uid-1', progressionWindowId: 'instance-2', locale: 'pt-BR',
    });
    const [a, b] = await Promise.all([
      claimAchievementMilestone(db, REQUEST, NOW),
      claimAchievementMilestone(db, next, NOW),
    ]);
    expect(a.outcome).toBe('CLAIMED');
    expect(b.outcome).toBe('CLAIMED');
    expect(a.milestoneId).not.toBe(b.milestoneId);
  });
});
