import { Timestamp } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';

import { createFakeFirestore } from '../../accountDeletion/firestoreCleanup/__tests__/fakeFirestore';
import { buildReEngagementEarlyNotification } from '../contentPolicy';
import { runNotificationPreflight } from '../notificationPreflight';

const NOW = Timestamp.fromDate(new Date('2026-09-14T08:30:00.000Z'));

function fixture() {
  const harness = createFakeFirestore();
  const uid = 'uid-reengagement';
  const root = `users/${uid}`;
  harness.seed(root, { preferences: {} });
  harness.seed(`${root}/workoutLifecycleState/current`, {
    activeContentIdentity: 'program-1',
    activeProgramInstanceId: 'instance-1',
  });
  harness.seed(`${root}/workoutProgramState/scheduleConfig`, { timezone: 'UTC' });
  harness.seed(`${root}/programInstances/instance-1`, {
    activatedAt: Timestamp.fromDate(new Date('2026-09-01T12:00:00.000Z')),
    contentIdentity: 'program-1',
    supersededAt: null,
  });
  harness.seed(`${root}/workoutPrograms/program-1`, {
    status: 'active',
    prescribedTrainingFrequency: 3,
    weeklySchedule: [
      { weekday: 'MON', state: 'TRAINING' },
      { weekday: 'TUE', state: 'REST' },
      { weekday: 'WED', state: 'TRAINING' },
      { weekday: 'THU', state: 'REST' },
      { weekday: 'FRI', state: 'TRAINING' },
      { weekday: 'SAT', state: 'REST' },
      { weekday: 'SUN', state: 'REST' },
    ],
    sessions: [{ exercises: [] }, { exercises: [] }, { exercises: [] }],
  });
  harness.seed(`${root}/workoutPrograms/program-1/scheduleState/instance-1`, {
    nextSessionIndex: 0,
    cursorDate: '2026-08-31',
    lastCompletedAt: null,
    pendingMissDecision: null,
  });
  const request = buildReEngagementEarlyNotification({
    uid,
    episodeIdentity: 'instance-1:2026-09-02',
    locale: 'pt-BR',
  });
  return { harness, uid, root, request };
}

describe('re-engagement dispatch preflight', () => {
  it('allows the still-current absence episode', async () => {
    const { harness, request } = fixture();
    await expect(runNotificationPreflight(harness.db as never, request, NOW))
      .resolves.toEqual({ allowed: true });
  });

  it('fences a return completed while evaluation was in flight', async () => {
    const { harness, root, request } = fixture();
    harness.seed(`${root}/workoutPrograms/program-1/scheduleState/instance-1`, {
      nextSessionIndex: 1,
      cursorDate: '2026-09-11',
      lastCompletedAt: '2026-09-11',
      pendingMissDecision: null,
    });
    await expect(runNotificationPreflight(harness.db as never, request, NOW))
      .resolves.toEqual({
        allowed: false,
        reason: 'INSUFFICIENT_MISSED_OPPORTUNITIES',
      });
  });

  it('fences a Program Instance replaced while evaluation was in flight', async () => {
    const { harness, root, request } = fixture();
    harness.seed(`${root}/workoutLifecycleState/current`, {
      activeContentIdentity: 'program-2',
      activeProgramInstanceId: 'instance-2',
    });
    await expect(runNotificationPreflight(harness.db as never, request, NOW))
      .resolves.toEqual({ allowed: false, reason: 'PROGRAM_UNAVAILABLE' });
  });
});
