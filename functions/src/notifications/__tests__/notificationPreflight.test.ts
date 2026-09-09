import { Timestamp } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';

import { createFakeFirestore } from '../../accountDeletion/firestoreCleanup/__tests__/fakeFirestore';
import {
  buildEvolutionApproachingNotification,
  buildWorkoutDayNotification,
} from '../contentPolicy';
import { runNotificationPreflight } from '../notificationPreflight';

const NOW = Timestamp.fromMillis(2_000_000_000_000);

function fixture() {
  const harness = createFakeFirestore();
  const uid = 'uid-1';
  harness.seed(`users/${uid}`, { preferences: {} });
  harness.seed(`users/${uid}/workoutLifecycleState/current`, {
    currentCycleId: 'cycle-1', activeProgramInstanceId: 'instance-1',
  });
  const request = buildEvolutionApproachingNotification({
    uid, progressionWindowId: 'instance-1', locale: 'pt-BR',
  });
  return { harness, uid, request };
}

describe('notification dispatch preflight', () => {
  it('allows an approaching candidate while its cycle is still current and unearned', async () => {
    const { harness, request } = fixture();
    await expect(runNotificationPreflight(harness.db as never, request, NOW))
      .resolves.toEqual({ allowed: true });
  });

  it.each(['EVOLUTION_EARNED', 'MOTIVATIONAL_RENEWAL_OFFERED'])
  ('gives %s priority over an approaching candidate', async (type) => {
    const { harness, uid, request } = fixture();
    harness.seed(`users/${uid}/workoutLifecycleEvents/event`, {
      cycleId: 'cycle-1', programInstanceId: 'instance-1', type,
    });
    await expect(runNotificationPreflight(harness.db as never, request, NOW)).resolves.toEqual({
      allowed: false, reason: 'EVOLUTION_UNLOCKED_PRIORITY',
    });
  });

  it('does not mistake an activation event that opened this window for a new earned fact', async () => {
    const { harness, uid, request } = fixture();
    harness.seed(`users/${uid}/workoutLifecycleEvents/activation`, {
      cycleId: 'cycle-1', programInstanceId: 'instance-1', type: 'LEVEL_PROMOTED',
    });
    await expect(runNotificationPreflight(harness.db as never, request, NOW))
      .resolves.toEqual({ allowed: true });
  });

  it('fences a candidate from a cycle superseded by a progression update', async () => {
    const { harness, uid, request } = fixture();
    harness.seed(`users/${uid}/workoutLifecycleState/current`, {
      currentCycleId: 'cycle-1', activeProgramInstanceId: 'instance-2',
    });
    await expect(runNotificationPreflight(harness.db as never, request, NOW)).resolves.toEqual({
      allowed: false, reason: 'PROGRESSION_WINDOW_CHANGED',
    });
  });

  it('does not apply achievement collisions to unrelated product types', async () => {
    const { harness, uid } = fixture();
    harness.seed(`users/${uid}/pendingEvolutions/current`, { cycleId: 'cycle-1' });
    // A WORKOUT_DAY retry is revalidated against its own domain, so the
    // pending evolution must not suppress it — but the workout fact itself
    // still has to be true, which is what the seeded program below provides.
    const monday = Timestamp.fromDate(new Date('2026-09-07T21:00:00.000Z'));
    harness.seed(`users/${uid}/workoutProgramState/scheduleConfig`, { timezone: 'UTC' });
    harness.seed(`users/${uid}/programInstances/instance-1`, {
      activatedAt: Timestamp.fromDate(new Date('2026-09-07T00:00:00.000Z')),
      contentIdentity: 'content-1',
      supersededAt: null,
    });
    harness.seed(`users/${uid}/workoutLifecycleState/current`, {
      currentCycleId: 'cycle-1',
      activeProgramInstanceId: 'instance-1',
      activeContentIdentity: 'content-1',
    });
    harness.seed(`users/${uid}/workoutPrograms/content-1`, {
      status: 'active',
      prescribedTrainingFrequency: 1,
      weeklySchedule: (['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const).map((weekday) => ({
        weekday,
        state: weekday === 'MON' ? 'TRAINING' : 'REST',
      })),
    });
    const workout = buildWorkoutDayNotification({ uid, localDate: '2026-09-07', locale: 'pt-BR' });
    await expect(runNotificationPreflight(harness.db as never, workout, monday))
      .resolves.toEqual({ allowed: true });
  });

  it('ignores a stale pending record from a replaced progression window', async () => {
    const { harness, uid, request } = fixture();
    harness.seed(`users/${uid}/pendingEvolutions/current`, {
      sourceProgramInstanceId: 'instance-old',
    });
    await expect(runNotificationPreflight(harness.db as never, request, NOW))
      .resolves.toEqual({ allowed: true });
  });
});
