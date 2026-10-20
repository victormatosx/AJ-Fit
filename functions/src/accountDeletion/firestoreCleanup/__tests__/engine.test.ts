import { describe, expect, it } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';

import { runFirestoreCleanup } from '../engine';
import { createFakeFirestore } from './fakeFirestore';
import type { ResourceCleanupResult } from '../types';

function fs(harness: ReturnType<typeof createFakeFirestore>): Firestore {
  return harness.db as unknown as Firestore;
}

function seedFullUser(harness: ReturnType<typeof createFakeFirestore>, uid: string) {
  harness.seed(`users/${uid}`);
  harness.seed(`users/${uid}/questionnaires/q1`);
  harness.seed(`users/${uid}/assessments/a1`);
  harness.seed(`users/${uid}/assessments/a2`);
  harness.seed(`users/${uid}/healthWeightSamples/w1`);
  harness.seed(`users/${uid}/progressPhotos/p1`);
  harness.seed(`users/${uid}/workoutPrograms/wpg1`);
  harness.seed(`users/${uid}/workoutProgramState/active`);
  harness.seed(`users/${uid}/workoutExecutions/exec1`);
  harness.seed(`users/${uid}/workoutFinalizationAttempts/attempt1`);
  harness.seed(`users/${uid}/workoutExecutionState/current`);
  harness.seed(`users/${uid}/workoutExecutionOccurrenceCounters/exec_wpg1_0_2026-10-03`);
  harness.seed(`users/${uid}/exerciseSubstitutionPreferences/bench_press`);
  harness.seed(`users/${uid}/workoutPrograms/wpg1/progressionEvents/pe1`);
  harness.seed(`users/${uid}/workoutPrograms/wpg1/scheduleState/state1`);
  harness.seed(`users/${uid}/workoutPrograms/wpg1/scheduleEvents/event1`);
  harness.seed(`users/${uid}/workoutLifecycleState/current`);
  harness.seed(`users/${uid}/trainingCycles/cyc1`);
  harness.seed(`users/${uid}/programInstances/wpi1`);
  harness.seed(`users/${uid}/workoutLifecycleEvents/wle1`);
  harness.seed(`users/${uid}/pendingEvolutions/current`);
  harness.seed(`users/${uid}/workoutLifecycleAuthorityGrants/current`);
  harness.seed(`users/${uid}/workoutLifecycleTrustedTelemetryReceipts/receipt1`);
  harness.seed(`users/${uid}/devices/install1`, { ownerUid: uid });
  harness.seed('pushInstallations/install1', {
    ownerUid: uid,
    tokenHash: 'token-hash',
    ownershipVersion: 1,
  });
  harness.seed('pushTokenOwners/token-hash', {
    ownerUid: uid,
    installationId: 'install1',
    ownershipVersion: 1,
  });
  harness.seed('notificationDispatches/dispatch1', { uid });
  harness.seed('notificationDispatches/dispatch1/deliveries/install1', { uid });
  harness.seed(`notificationDailyUsers/${uid}`, { timezone: 'UTC' });
  harness.seed(`notificationProductWindows/window-${uid}`, { uid });
  harness.seed(`notificationAchievementMilestones/milestone-${uid}`, { uid });
  harness.seed(`entitlementSignals/${uid}`);
  harness.seed(`users/${uid}/privateSecurity/photoVault`);
}

describe('runFirestoreCleanup — happy path', () => {
  it('an empty user (nothing seeded) succeeds', async () => {
    const harness = createFakeFirestore();
    await expect(runFirestoreCleanup('uid-1', { db: fs(harness) })).resolves.toEqual({ kind: 'SUCCEEDED' });
  });

  it('a user with only a profile document succeeds and removes it', async () => {
    const harness = createFakeFirestore();
    harness.seed('users/uid-1');
    await expect(runFirestoreCleanup('uid-1', { db: fs(harness) })).resolves.toEqual({ kind: 'SUCCEEDED' });
    expect(harness.exists('users/uid-1')).toBe(false);
  });

  it('a fully populated user has every deletable resource removed', async () => {
    const harness = createFakeFirestore();
    seedFullUser(harness, 'uid-1');

    const outcome = await runFirestoreCleanup('uid-1', { db: fs(harness) });

    expect(outcome).toEqual({ kind: 'SUCCEEDED' });
    expect(harness.exists('users/uid-1')).toBe(false);
    expect(harness.listUnder('users/uid-1/questionnaires/')).toHaveLength(0);
    expect(harness.listUnder('users/uid-1/assessments/')).toHaveLength(0);
    expect(harness.listUnder('users/uid-1/healthWeightSamples/')).toHaveLength(0);
    expect(harness.listUnder('users/uid-1/progressPhotos/')).toHaveLength(0);
    expect(harness.listUnder('users/uid-1/workoutPrograms/')).toHaveLength(0);
    expect(harness.listUnder('users/uid-1/workoutProgramState/')).toHaveLength(0);
    expect(harness.listUnder('users/uid-1/workoutExecutions/')).toHaveLength(0);
    expect(harness.listUnder('users/uid-1/workoutFinalizationAttempts/')).toHaveLength(0);
    expect(harness.listUnder('users/uid-1/workoutExecutionState/')).toHaveLength(0);
    expect(harness.listUnder('users/uid-1/workoutExecutionOccurrenceCounters/')).toHaveLength(0);
    expect(harness.listUnder('users/uid-1/exerciseSubstitutionPreferences/')).toHaveLength(0);
    expect(harness.listUnder('users/uid-1/workoutPrograms/wpg1/progressionEvents/')).toHaveLength(0);
    expect(harness.listUnder('users/uid-1/workoutPrograms/wpg1/scheduleState/')).toHaveLength(0);
    expect(harness.listUnder('users/uid-1/workoutPrograms/wpg1/scheduleEvents/')).toHaveLength(0);
    expect(harness.listUnder('users/uid-1/workoutLifecycleState/')).toHaveLength(0);
    expect(harness.listUnder('users/uid-1/trainingCycles/')).toHaveLength(0);
    expect(harness.listUnder('users/uid-1/programInstances/')).toHaveLength(0);
    expect(harness.listUnder('users/uid-1/workoutLifecycleEvents/')).toHaveLength(0);
    expect(harness.listUnder('users/uid-1/pendingEvolutions/')).toHaveLength(0);
    expect(harness.listUnder('users/uid-1/workoutLifecycleAuthorityGrants/')).toHaveLength(0);
    expect(harness.listUnder('users/uid-1/workoutLifecycleTrustedTelemetryReceipts/')).toHaveLength(0);
    expect(harness.listUnder('users/uid-1/devices/')).toHaveLength(0);
    expect(harness.exists('pushTokenOwners/token-hash')).toBe(false);
    expect(harness.data('pushInstallations/install1')?.ownerUid).toBeNull();
    expect(harness.exists('notificationDispatches/dispatch1')).toBe(false);
    expect(harness.exists('notificationDispatches/dispatch1/deliveries/install1')).toBe(false);
    expect(harness.exists('notificationDailyUsers/uid-1')).toBe(false);
    expect(harness.exists('notificationProductWindows/window-uid-1')).toBe(false);
    expect(harness.exists('notificationAchievementMilestones/milestone-uid-1')).toBe(false);
    expect(harness.exists('entitlementSignals/uid-1')).toBe(false);
  });

  it('cleanup outcome is identical for a Free or Premium user (no subscription check exists here)', async () => {
    const harnessFree = createFakeFirestore();
    seedFullUser(harnessFree, 'uid-free');
    const harnessPremium = createFakeFirestore();
    seedFullUser(harnessPremium, 'uid-premium');

    const [free, premium] = await Promise.all([
      runFirestoreCleanup('uid-free', { db: fs(harnessFree) }),
      runFirestoreCleanup('uid-premium', { db: fs(harnessPremium) }),
    ]);

    expect(free).toEqual({ kind: 'SUCCEEDED' });
    expect(premium).toEqual({ kind: 'SUCCEEDED' });
  });

  it('handles hundreds of documents across resource categories', async () => {
    const harness = createFakeFirestore();
    harness.seed('users/uid-1');
    for (let i = 0; i < 400; i++) harness.seed(`users/uid-1/assessments/a${i}`);
    for (let i = 0; i < 200; i++) harness.seed(`users/uid-1/progressPhotos/p${i}`);

    await expect(runFirestoreCleanup('uid-1', { db: fs(harness) })).resolves.toEqual({ kind: 'SUCCEEDED' });
    expect(harness.listUnder('users/uid-1/assessments/')).toHaveLength(0);
    expect(harness.listUnder('users/uid-1/progressPhotos/')).toHaveLength(0);
  });
});

describe('runFirestoreCleanup — Vault separation (Fase 6 §11/§12, the key architectural gate)', () => {
  it('never touches privateSecurity/photoVault — that is VAULT_KEY_DESTRUCTION’s job, not this engine’s', async () => {
    const harness = createFakeFirestore();
    seedFullUser(harness, 'uid-1');

    await runFirestoreCleanup('uid-1', { db: fs(harness) });

    expect(harness.exists('users/uid-1/privateSecurity/photoVault')).toBe(true);
  });

  it('succeeds identically whether the vault key was already destroyed or not — this engine never checks', async () => {
    const withVault = createFakeFirestore();
    seedFullUser(withVault, 'uid-1');

    const withoutVault = createFakeFirestore();
    seedFullUser(withoutVault, 'uid-2');
    withoutVault.seed('__marker'); // no-op, keeps structure parallel
    // Simulate VAULT_KEY_DESTRUCTION having already run for uid-2.
    await withoutVault.db.collection('users/uid-2/privateSecurity').doc('photoVault').delete();

    const a = await runFirestoreCleanup('uid-1', { db: fs(withVault) });
    const b = await runFirestoreCleanup('uid-2', { db: fs(withoutVault) });

    expect(a).toEqual({ kind: 'SUCCEEDED' });
    expect(b).toEqual({ kind: 'SUCCEEDED' });
  });
});

describe('runFirestoreCleanup — retained data and control plane are structurally unreachable', () => {
  it('never targets retained support/coupon data or account-deletion control-plane collections', async () => {
    // This is a structural guarantee, not a runtime one: resources.ts only
    // ever builds paths under `users/{uid}/...`. This test documents the
    // property by seeding retained/control-plane data at those exact paths
    // and confirming cleanup for the SAME uid never removes them.
    const harness = createFakeFirestore();
    seedFullUser(harness, 'uid-1');
    harness.seed('supportCases/case-1');
    harness.seed('couponRedemptions/uid-1');
    harness.seed('accountDeletions/del-1');
    harness.seed('accountDeletionLocks/uid-1');

    await runFirestoreCleanup('uid-1', { db: fs(harness) });

    expect(harness.exists('supportCases/case-1')).toBe(true);
    expect(harness.exists('couponRedemptions/uid-1')).toBe(true);
    expect(harness.exists('accountDeletions/del-1')).toBe(true);
    expect(harness.exists('accountDeletionLocks/uid-1')).toBe(true);
  });
});

describe('runFirestoreCleanup — ordering (Fase 6 §10)', () => {
  it('deletes subcollections before the parent users/{uid} document', async () => {
    const harness = createFakeFirestore();
    seedFullUser(harness, 'uid-1');
    const order: string[] = [];

    await runFirestoreCleanup('uid-1', {
      db: fs(harness),
      onResourceCompleted: (result: ResourceCleanupResult) => order.push(result.resource),
    });

    expect(order).toEqual([
      'questionnaires', 'assessments', 'healthWeightSamples', 'nutrition', 'progressPhotos',
      'pushTokenOwners', 'pushInstallations', 'pushDevices', 'notificationDispatches',
      'notificationProductWindows', 'notificationAchievementMilestones', 'dailyNotificationRegistration', 'entitlementSignal',
      'workoutProgramDescendants',
      'workoutLifecycleEvents', 'workoutLifecycleAuthorityGrants', 'workoutLifecycleTrustedTelemetryReceipts', 'pendingEvolutions', 'programInstances', 'trainingCycles', 'workoutLifecycleState',
      'workoutPrograms', 'workoutProgramState', 'exerciseSubstitutionPreferences', 'workoutExecutionState', 'workoutExecutionOccurrenceCounters', 'workoutFinalizationAttempts', 'workoutDailyCompletions', 'workoutExecutions', 'userProfile',
    ]);
  });
});

describe('runFirestoreCleanup — retry after partial failure (Fase 6 §21)', () => {
  it('a failure on the FIRST resource leaves everything else untouched, and a retry finishes all of it', async () => {
    const harness = createFakeFirestore();
    seedFullUser(harness, 'uid-1');

    // questionnaires is the first resource `runFirestoreCleanup` attempts —
    // fail its flush specifically.
    harness.failNextBulkWriterClose(new Error('boom'));
    const first = await runFirestoreCleanup('uid-1', { db: fs(harness) });
    expect(first.kind).toBe('FAILED');

    // Nothing was deleted yet — the very first resource's flush failed.
    expect(harness.listUnder('users/uid-1/questionnaires/')).toHaveLength(1);
    expect(harness.listUnder('users/uid-1/assessments/')).toHaveLength(2); // never reached
    expect(harness.exists('users/uid-1')).toBe(true); // never reached

    const retry = await runFirestoreCleanup('uid-1', { db: fs(harness) });
    expect(retry).toEqual({ kind: 'SUCCEEDED' });
    expect(harness.exists('users/uid-1')).toBe(false);
    expect(harness.listUnder('users/uid-1/questionnaires/')).toHaveLength(0);
    expect(harness.listUnder('users/uid-1/assessments/')).toHaveLength(0);
  });

  it('a failure on a LATER resource preserves the earlier ones already applied', async () => {
    const harness = createFakeFirestore();
    seedFullUser(harness, 'uid-1');

    // Let questionnaires succeed, then fail assessments' flush.
    await runFirestoreCleanup('uid-1', {
      db: fs(harness),
      onResourceCompleted: (result) => {
        if (result.resource === 'questionnaires') {
          harness.failNextBulkWriterClose(new Error('boom on assessments'));
        }
      },
    });

    expect(harness.listUnder('users/uid-1/questionnaires/')).toHaveLength(0); // already done, preserved
    expect(harness.listUnder('users/uid-1/assessments/')).toHaveLength(2); // failed, untouched

    const retry = await runFirestoreCleanup('uid-1', { db: fs(harness) });
    expect(retry).toEqual({ kind: 'SUCCEEDED' });
    expect(harness.listUnder('users/uid-1/assessments/')).toHaveLength(0);
  });
});

describe('runFirestoreCleanup — concurrency', () => {
  it('two concurrent cleanups for the same uid both converge on a fully-cleaned state', async () => {
    const harness = createFakeFirestore();
    seedFullUser(harness, 'uid-1');

    const [a, b] = await Promise.all([
      runFirestoreCleanup('uid-1', { db: fs(harness) }),
      runFirestoreCleanup('uid-1', { db: fs(harness) }),
    ]);

    expect(a.kind).toBe('SUCCEEDED');
    expect(b.kind).toBe('SUCCEEDED');
    expect(harness.exists('users/uid-1')).toBe(false);
  });
});

describe('runFirestoreCleanup — other uid isolation', () => {
  it('cleaning up one uid leaves a fully populated other uid 100% intact', async () => {
    const harness = createFakeFirestore();
    seedFullUser(harness, 'uid-A');
    seedFullUser(harness, 'uid-B');

    await runFirestoreCleanup('uid-A', { db: fs(harness) });

    expect(harness.exists('users/uid-A')).toBe(false);
    expect(harness.exists('users/uid-B')).toBe(true);
    expect(harness.listUnder('users/uid-B/questionnaires/')).toHaveLength(1);
    expect(harness.listUnder('users/uid-B/assessments/')).toHaveLength(2);
    expect(harness.listUnder('users/uid-B/progressPhotos/')).toHaveLength(1);
    expect(harness.exists('users/uid-B/privateSecurity/photoVault')).toBe(true);
  });
});
