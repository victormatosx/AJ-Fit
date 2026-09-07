import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';

import { buildQaTestNotification } from '../contentPolicy';
import { loadEligibleDevices } from '../deviceEligibility';
import { dispatchNotification, type DispatcherDependencies } from '../dispatcher';
import type {
  ExpoPushClient,
  ExpoReceiptResult,
  ExpoTicketResult,
} from '../expoPushClient';
import {
  claimDispatch,
  markDispatchOutcome,
  NotificationIdempotencyConflictError,
} from '../idempotency';
import { runReceiptsReconciliation } from '../receiptsReconciler';
import { runDispatchRetries } from '../retryScheduler';
import { NOTIFICATION_DISPATCHES_COLLECTION } from '../schema';
import { createPushDeviceHandlers } from '../../pushDevices/pushDeviceRegistration';

const enabled = process.env.PUSH_FOUNDATION_INTEGRATION === '1';

const UID_A = 'user-A';
const UID_B = 'user-B';
const INSTALLATION = '10000000-0000-4000-8000-000000000001';
const INSTALLATION_2 = '10000000-0000-4000-8000-000000000002';
const SECRET = '20000000-0000-4000-8000-000000000001';
const SESSION_A = '30000000-0000-4000-8000-000000000001';
const SESSION_B = '30000000-0000-4000-8000-000000000002';

describe.skipIf(!enabled)('push foundation — Firestore Emulator', () => {
  let app: App;
  let db: Firestore;
  let now: Timestamp;

  beforeAll(() => {
    app = initializeApp({ projectId: 'ajfit-rules-test' }, `push-foundation-${randomUUID()}`);
    db = getFirestore(app);
  });

  afterAll(async () => deleteApp(app));

  beforeEach(async () => {
    now = Timestamp.fromMillis(2_000_000_000_000);
    for (const collectionName of [
      'users',
      'pushInstallations',
      'pushTokenOwners',
      NOTIFICATION_DISPATCHES_COLLECTION,
      'accountDeletionLocks',
    ]) {
      const snapshot = await db.collection(collectionName).get();
      await Promise.all(snapshot.docs.map((document) => db.recursiveDelete(document.ref)));
    }
    await Promise.all([
      db.collection('users').doc(UID_A).set({
        preferences: {},
        metadata: { role: 'admin' },
      }),
      db.collection('users').doc(UID_B).set({
        preferences: {},
        metadata: { role: 'user' },
      }),
    ]);
  });

  function fakeExpo(overrides: Partial<ExpoPushClient> = {}): ExpoPushClient {
    return {
      send: vi.fn(async (messages: Parameters<ExpoPushClient['send']>[0]) =>
        messages.map((_, index): ExpoTicketResult => ({
          ok: true,
          ticketId: `ticket-${index}`,
        }))),
      getReceipts: vi.fn(async () => new Map<string, ExpoReceiptResult>()),
      ...overrides,
    };
  }

  function dependencies(expoClient: ExpoPushClient): DispatcherDependencies {
    return { db, expoClient, now: () => now, random: () => 0.5 };
  }

  function qaRequest(overrides: Partial<ReturnType<typeof buildQaTestNotification>> = {}) {
    return {
      ...buildQaTestNotification({
        uid: UID_A,
        notificationId: 'qa-test-1',
        sourceIdentity: 'qa-probe:user-A:1',
        idempotencyKey: 'qa-test:user-A:1',
      }),
      ...overrides,
    };
  }

  async function seedEligibleDevice(
    uid = UID_A,
    installationId = INSTALLATION,
    tokenHash = 'a'.repeat(64),
    ownershipVersion = 1,
  ) {
    const lease = Timestamp.fromMillis(now.toMillis() + 86_400_000);
    await Promise.all([
      db.collection('users').doc(uid).collection('devices').doc(installationId).set({
        installationId,
        platform: 'android',
        permissionStatus: 'granted',
        pushEnabled: true,
        tokenHash,
        ownershipVersion,
        leaseExpiresAt: lease,
        disabledAt: null,
        invalidAt: null,
      }),
      db.collection('pushInstallations').doc(installationId).set({
        installationId,
        ownerUid: uid,
        platform: 'android',
        permissionStatus: 'granted',
        pushEnabled: true,
        tokenHash,
        ownershipVersion,
        leaseExpiresAt: lease,
        releasedAt: null,
        disabledAt: null,
        invalidAt: null,
      }),
      db.collection('pushTokenOwners').doc(tokenHash).set({
        tokenHash,
        ownerUid: uid,
        installationId,
        ownershipVersion,
        active: true,
        invalidAt: null,
        leaseExpiresAt: lease,
        expoPushToken: `ExponentPushToken[${installationId}]`,
      }),
    ]);
  }

  function syncData(overrides: Record<string, unknown> = {}) {
    return {
      installationId: INSTALLATION,
      installationSecret: SECRET,
      sessionBindingId: SESSION_A,
      expectedOwnershipVersion: 0,
      platform: 'android',
      permissionStatus: 'granted',
      expoPushToken: 'ExponentPushToken[token-aaaaaaaa]',
      nativePushToken: { type: 'android', data: 'native-token-aaaaaaaa' },
      ...overrides,
    };
  }

  function handlers() {
    return createPushDeviceHandlers({
      db,
      now: () => now,
      requireActive: async () => undefined,
    });
  }

  describe('device ownership lifecycle', () => {
    it('supports multiple installations for one account', async () => {
      const service = handlers();
      const first = await service.sync({
        auth: { uid: UID_A },
        data: syncData(),
      } as never);
      const second = await service.sync({
        auth: { uid: UID_A },
        data: syncData({
          installationId: INSTALLATION_2,
          installationSecret: '20000000-0000-4000-8000-000000000002',
          sessionBindingId: '30000000-0000-4000-8000-000000000003',
          expoPushToken: 'ExponentPushToken[token-bbbbbbbb]',
          nativePushToken: { type: 'android', data: 'native-token-bbbbbbbb' },
        }),
      } as never);

      expect(first.ownershipVersion).toBe(1);
      expect(second.ownershipVersion).toBe(1);
      expect((await db.collection('users').doc(UID_A).collection('devices').get()).size).toBe(2);
    });

    it('fences delayed A release after transfer and sync by B', async () => {
      const service = handlers();
      const a = await service.sync({ auth: { uid: UID_A }, data: syncData() } as never);
      const b = await service.sync({
        auth: { uid: UID_B },
        data: syncData({
          sessionBindingId: SESSION_B,
          expectedOwnershipVersion: a.ownershipVersion,
        }),
      } as never);
      const staleRelease = await service.release({
        auth: null,
        data: {
          installationId: INSTALLATION,
          installationSecret: SECRET,
          ownerUid: UID_A,
          ownershipVersion: a.ownershipVersion,
        },
      } as never);

      expect(b.ownershipVersion).toBeGreaterThan(a.ownershipVersion);
      expect(staleRelease.status).toBe('stale-release');
      expect((await db.collection('pushInstallations').doc(INSTALLATION).get()).data()?.ownerUid)
        .toBe(UID_B);
      expect((await db.collection('users').doc(UID_B).collection('devices').doc(INSTALLATION).get()).exists)
        .toBe(true);
    });

    it('fences a delayed sync from A after B has taken a newer ownership version', async () => {
      const service = handlers();
      const a = await service.sync({ auth: { uid: UID_A }, data: syncData() } as never);
      const b = await service.sync({
        auth: { uid: UID_B },
        data: syncData({
          sessionBindingId: SESSION_B,
          expectedOwnershipVersion: a.ownershipVersion,
        }),
      } as never);
      const delayedA = await service.sync({
        auth: { uid: UID_A },
        data: syncData({ expectedOwnershipVersion: a.ownershipVersion }),
      } as never);

      expect(delayedA.status).toBe('stale-sync');
      expect(delayedA.ownershipVersion).toBe(b.ownershipVersion);
      expect((await db.collection('pushInstallations').doc(INSTALLATION).get()).data())
        .toMatchObject({ ownerUid: UID_B, ownershipVersion: b.ownershipVersion });
    });

    it('fails closed when an existing installation has no proof hash', async () => {
      await db.collection('pushInstallations').doc(INSTALLATION).set({
        ownerUid: UID_A,
        ownershipVersion: 1,
      });

      await expect(handlers().release({
        auth: null,
        data: {
          installationId: INSTALLATION,
          installationSecret: SECRET,
          ownerUid: UID_A,
          ownershipVersion: 1,
        },
      } as never)).rejects.toMatchObject({
        code: 'permission-denied',
        message: 'installation_proof_missing',
      });
      expect((await db.collection('pushInstallations').doc(INSTALLATION).get()).data()?.ownerUid)
        .toBe(UID_A);
    });

    it('rotates ownership fencing on token refresh and removes the old raw token', async () => {
      const service = handlers();
      const first = await service.sync({ auth: { uid: UID_A }, data: syncData() } as never);
      const oldHash = (await db.collection('pushInstallations').doc(INSTALLATION).get()).data()?.tokenHash;
      const refreshed = await service.sync({
        auth: { uid: UID_A },
        data: syncData({
          expectedOwnershipVersion: first.ownershipVersion,
          expoPushToken: 'ExponentPushToken[token-cccccccc]',
          nativePushToken: { type: 'android', data: 'native-token-cccccccc' },
        }),
      } as never);

      expect(refreshed.ownershipVersion).toBeGreaterThan(first.ownershipVersion);
      expect((await db.collection('pushTokenOwners').doc(oldHash).get()).exists).toBe(false);
    });

    it('revoked permission disables the device and deletes its raw token', async () => {
      const service = handlers();
      await service.sync({ auth: { uid: UID_A }, data: syncData() } as never);
      const tokenHash = (await db.collection('pushInstallations').doc(INSTALLATION).get()).data()?.tokenHash;
      const disabled = await service.sync({
        auth: { uid: UID_A },
        data: syncData({
          expectedOwnershipVersion: 1,
          permissionStatus: 'denied',
          expoPushToken: undefined,
          nativePushToken: undefined,
        }),
      } as never);

      expect(disabled.pushEnabled).toBe(false);
      expect((await db.collection('pushTokenOwners').doc(tokenHash).get()).exists).toBe(false);
    });
  });

  describe('eligibility pagination', () => {
    it('finds a valid device after more than twenty expired leases', async () => {
      const expired = Timestamp.fromMillis(now.toMillis() - 1);
      for (let index = 0; index < 26; index += 1) {
        const id = `expired-${String(index).padStart(2, '0')}`;
        await db.collection('users').doc(UID_A).collection('devices').doc(id).set({
          pushEnabled: true,
          permissionStatus: 'granted',
          platform: 'android',
          tokenHash: String(index).padStart(64, '0'),
          ownershipVersion: 1,
          leaseExpiresAt: expired,
          disabledAt: null,
          invalidAt: null,
        });
      }
      await seedEligibleDevice(UID_A, 'z-valid-device', 'f'.repeat(64), 7);

      const selected = await loadEligibleDevices(UID_A, db, now);

      expect(selected.scannedCount).toBeGreaterThan(20);
      expect(selected.eligible.map((device) => device.installationId)).toEqual(['z-valid-device']);
    });

    it('excludes disabled, revoked and invalid-token records while retaining a valid device', async () => {
      await Promise.all([
        seedEligibleDevice(UID_A, 'device-disabled', '1'.repeat(64), 1),
        seedEligibleDevice(UID_A, 'device-revoked', '2'.repeat(64), 1),
        seedEligibleDevice(UID_A, 'device-invalid-token', '3'.repeat(64), 1),
        seedEligibleDevice(UID_A, 'device-valid', '4'.repeat(64), 1),
      ]);
      await Promise.all([
        db.collection('users').doc(UID_A).collection('devices').doc('device-disabled').update({
          pushEnabled: false,
          disabledAt: now,
        }),
        db.collection('users').doc(UID_A).collection('devices').doc('device-revoked').update({
          permissionStatus: 'denied',
        }),
        db.collection('pushTokenOwners').doc('3'.repeat(64)).update({
          active: false,
          invalidAt: now,
        }),
      ]);

      const selected = await loadEligibleDevices(UID_A, db, now);

      expect(selected.eligible.map((device) => device.installationId)).toEqual(['device-valid']);
      expect(selected.excluded).toEqual(expect.arrayContaining([
        { installationId: 'device-disabled', reason: 'PUSH_DISABLED' },
        { installationId: 'device-revoked', reason: 'PERMISSION_REVOKED' },
        { installationId: 'device-invalid-token', reason: 'TOKEN_INVALID' },
      ]));
    });
  });

  describe('idempotency and dispatcher', () => {
    it('allows one concurrent worker and fences a stale claimant', async () => {
      const request = qaRequest();
      const [first, second] = await Promise.all([
        claimDispatch(db, request, now),
        claimDispatch(db, request, now),
      ]);
      expect([first.outcome, second.outcome].sort()).toEqual([
        'CLAIMED',
        'DUPLICATE_IN_PROGRESS',
      ]);

      const initial = first.claimToken ? first : second;
      const later = Timestamp.fromMillis(now.toMillis() + 11 * 60 * 1000);
      const replacement = await claimDispatch(db, request, later);
      expect(replacement.outcome).toBe('RETRY_ALLOWED');
      await expect(markDispatchOutcome(
        db,
        initial.dispatchId,
        initial.claimToken!,
        { status: 'NO_ELIGIBLE_DEVICE' },
        later,
      )).resolves.toBe(false);
      await expect(markDispatchOutcome(
        db,
        replacement.dispatchId,
        replacement.claimToken!,
        { status: 'NO_ELIGIBLE_DEVICE' },
        later,
      )).resolves.toBe(true);
    });

    it.each([
      { uid: UID_B },
      { sourceIdentity: 'qa-probe:user-A:other' },
      { notificationId: 'qa-test-other' },
      { type: 'FUTURE_TYPE' },
    ])('rejects same key with a changed semantic contract %#', async (override) => {
      const first = qaRequest();
      await claimDispatch(db, first, now);
      await expect(claimDispatch(db, {
        ...first,
        ...override,
      } as never, now)).rejects.toBeInstanceOf(NotificationIdempotencyConflictError);
    });

    it.each([
      'RATE_LIMITED',
      'SERVER_ERROR',
      'NETWORK_ERROR',
      'TIMEOUT',
      'MessageRateExceeded',
    ])('persists retryable provider failure %s', async (errorCode) => {
      await seedEligibleDevice();
      const retryable = fakeExpo({
        send: vi.fn(async (): Promise<ExpoTicketResult[]> => [
          { ok: false, errorCode },
        ]),
      });
      const retryResult = await dispatchNotification(qaRequest(), dependencies(retryable));
      expect(retryResult.status).toBe('RETRY_SCHEDULED');
      expect((await db.collection(NOTIFICATION_DISPATCHES_COLLECTION)
        .doc(retryResult.dispatchId).get()).data()).toMatchObject({
          status: 'RETRY_SCHEDULED',
          attemptCount: 1,
          lastErrorClass: 'PROVIDER_RETRYABLE',
        });
    });

    it('never retries a terminal ticket error', async () => {
      await seedEligibleDevice();
      const terminalRequest = qaRequest({
        notificationId: 'qa-test-terminal',
        sourceIdentity: 'qa-probe:user-A:terminal',
        idempotencyKey: 'qa-test:user-A:terminal',
      });
      const terminal = fakeExpo({
        send: vi.fn(async (): Promise<ExpoTicketResult[]> => [
          { ok: false, errorCode: 'InvalidCredentials' },
        ]),
      });
      const terminalResult = await dispatchNotification(terminalRequest, dependencies(terminal));
      expect(terminalResult.status).toBe('FAILED_TERMINAL');
      expect((await db.collection(NOTIFICATION_DISPATCHES_COLLECTION)
        .doc(terminalResult.dispatchId).get()).data()?.nextAttemptAt).toBeNull();
    });

    it('exhausts persistent retryable tickets after the bounded fifth attempt', async () => {
      await seedEligibleDevice();
      const expo = fakeExpo({
        send: vi.fn(async (): Promise<ExpoTicketResult[]> => [
          { ok: false, errorCode: 'SERVER_ERROR' },
        ]),
      });

      let result = await dispatchNotification(qaRequest(), dependencies(expo));
      while (result.status === 'RETRY_SCHEDULED') {
        const snapshot = await db.collection(NOTIFICATION_DISPATCHES_COLLECTION)
          .doc(result.dispatchId).get();
        now = snapshot.data()?.nextAttemptAt as Timestamp;
        result = await dispatchNotification(qaRequest(), dependencies(expo));
      }
      const finalSnapshot = await db.collection(NOTIFICATION_DISPATCHES_COLLECTION)
        .doc(result.dispatchId).get();

      expect(result.status).toBe('FAILED_RETRY_EXHAUSTED');
      expect(expo.send).toHaveBeenCalledTimes(5);
      expect(finalSnapshot.data()).toMatchObject({
        status: 'FAILED_RETRY_EXHAUSTED',
        attemptCount: 5,
        nextAttemptAt: null,
        terminalReason: 'DISPATCH_RETRY_EXHAUSTED',
      });
    });

    it('deduplicates successful concurrent dispatch workers', async () => {
      await seedEligibleDevice();
      const expo = fakeExpo();
      const [a, b] = await Promise.all([
        dispatchNotification(qaRequest(), dependencies(expo)),
        dispatchNotification(qaRequest(), dependencies(expo)),
      ]);
      expect([a.status, b.status].sort()).toEqual(['DUPLICATE', 'PENDING_RECEIPTS']);
      expect(expo.send).toHaveBeenCalledTimes(1);
    });

    it('retries only the failed delivery after persistent backoff becomes due', async () => {
      await seedEligibleDevice();
      const firstExpo = fakeExpo({
        send: vi.fn(async (): Promise<ExpoTicketResult[]> => [
          { ok: false, errorCode: 'SERVER_ERROR' },
        ]),
      });
      const first = await dispatchNotification(qaRequest(), dependencies(firstExpo));
      const firstSnapshot = await db.collection(NOTIFICATION_DISPATCHES_COLLECTION)
        .doc(first.dispatchId).get();
      now = firstSnapshot.data()?.nextAttemptAt as Timestamp;

      const retryExpo = fakeExpo();
      const retried = await runDispatchRetries(dependencies(retryExpo));
      const finalSnapshot = await firstSnapshot.ref.get();

      expect(retried).toMatchObject({ candidateCount: 1, processed: 1, failed: 0 });
      expect(retryExpo.send).toHaveBeenCalledTimes(1);
      expect(finalSnapshot.data()).toMatchObject({
        status: 'PENDING_RECEIPTS',
        attemptCount: 2,
        nextAttemptAt: null,
      });
    });

    it('moves from pending tickets to a partial parent after mixed receipt outcomes', async () => {
      await Promise.all([
        seedEligibleDevice(UID_A, INSTALLATION, '5'.repeat(64), 1),
        seedEligibleDevice(UID_A, INSTALLATION_2, '6'.repeat(64), 1),
      ]);
      const expo = fakeExpo({
        send: vi.fn(async (): Promise<ExpoTicketResult[]> => [
          { ok: true, ticketId: 'ticket-confirmed' },
          { ok: false, errorCode: 'InvalidCredentials' },
        ]),
        getReceipts: vi.fn(async () => new Map([
          ['ticket-confirmed', { status: 'ok' as const }],
        ])),
      });
      const dispatched = await dispatchNotification(qaRequest(), dependencies(expo));
      expect(dispatched.status).toBe('PENDING_RECEIPTS');

      now = Timestamp.fromMillis(now.toMillis() + 16 * 60 * 1000);
      await runReceiptsReconciliation({ db, expoClient: expo, now: () => now });
      const parent = await db.collection(NOTIFICATION_DISPATCHES_COLLECTION)
        .doc(dispatched.dispatchId).get();

      expect(parent.data()).toMatchObject({
        status: 'PARTIAL',
        confirmedCount: 1,
        failedCount: 1,
      });
    });
  });

  async function seedPendingReceipt(params: {
    dispatchId: string;
    uid: string;
    ownershipVersion: number;
    tokenHash: string;
    receiptAttemptCount?: number;
  }) {
    const parent = db.collection(NOTIFICATION_DISPATCHES_COLLECTION).doc(params.dispatchId);
    await parent.set({
      uid: params.uid,
      status: 'PENDING_RECEIPTS',
      deliveryRevision: 1,
      createdAt: now,
      updatedAt: now,
    });
    await parent.collection('deliveries').doc(INSTALLATION).set({
      uid: params.uid,
      installationId: INSTALLATION,
      ownershipVersion: params.ownershipVersion,
      tokenHash: params.tokenHash,
      ticketId: `ticket-${params.dispatchId}`,
      status: 'PENDING_RECEIPT',
      receiptAttemptCount: params.receiptAttemptCount ?? 0,
      receiptNextCheckAt: now,
      receiptClaimToken: null,
      receiptClaimUntil: null,
      updatedAt: now,
    });
  }

  describe('receipt reconciliation', () => {
    it('invalidates the exact current installation for DeviceNotRegistered', async () => {
      const tokenHash = 'a'.repeat(64);
      await seedEligibleDevice(UID_A, INSTALLATION, tokenHash, 1);
      await seedPendingReceipt({
        dispatchId: 'dispatch-current-invalid',
        uid: UID_A,
        ownershipVersion: 1,
        tokenHash,
      });
      const expo = fakeExpo({
        getReceipts: vi.fn(async (ids: string[]) => new Map(ids.map((id) => [
          id,
          { status: 'error', errorCode: 'DeviceNotRegistered' } as ExpoReceiptResult,
        ]))),
      });

      const result = await runReceiptsReconciliation({ db, expoClient: expo, now: () => now });

      expect(result.invalidToken).toBe(1);
      expect((await db.collection('pushTokenOwners').doc(tokenHash).get()).exists).toBe(false);
      expect((await db.collection('pushInstallations').doc(INSTALLATION).get()).data())
        .toMatchObject({ pushEnabled: false, ownershipVersion: 1 });
      expect((await db.collection('users').doc(UID_A).collection('devices')
        .doc(INSTALLATION).get()).data()).toMatchObject({ pushEnabled: false });
    });

    it('fences a stale receipt from A after the installation belongs to B', async () => {
      const tokenHash = 'b'.repeat(64);
      await seedEligibleDevice(UID_B, INSTALLATION, tokenHash, 2);
      await seedPendingReceipt({
        dispatchId: 'dispatch-stale-a',
        uid: UID_A,
        ownershipVersion: 1,
        tokenHash,
      });
      const expo = fakeExpo({
        getReceipts: vi.fn(async (ids: string[]) => new Map<string, ExpoReceiptResult>(ids.map((id) => [
          id,
          { status: 'error', errorCode: 'DeviceNotRegistered' } as ExpoReceiptResult,
        ]))),
      });

      const result = await runReceiptsReconciliation({
        db,
        expoClient: expo,
        now: () => now,
      });

      expect(result.invalidToken).toBe(1);
      expect((await db.collection('pushInstallations').doc(INSTALLATION).get()).data())
        .toMatchObject({ ownerUid: UID_B, pushEnabled: true, ownershipVersion: 2 });
      expect((await db.collection('pushTokenOwners').doc(tokenHash).get()).exists).toBe(true);
    });

    it('claims a receipt only once across concurrent reconcilers', async () => {
      await seedPendingReceipt({
        dispatchId: 'dispatch-concurrent',
        uid: UID_A,
        ownershipVersion: 1,
        tokenHash: 'c'.repeat(64),
      });
      const getReceipts = vi.fn(async (ids: string[]) =>
        new Map(ids.map((id) => [id, { status: 'ok' as const }])));
      const expo = fakeExpo({ getReceipts });

      const [a, b] = await Promise.all([
        runReceiptsReconciliation({ db, expoClient: expo, now: () => now }),
        runReceiptsReconciliation({ db, expoClient: expo, now: () => now }),
      ]);

      expect(a.claimedCount + b.claimedCount).toBe(1);
      expect(getReceipts).toHaveBeenCalledTimes(1);
    }, 15_000);

    it('moves the fifth inconclusive check to explicit receipt exhaustion', async () => {
      await seedPendingReceipt({
        dispatchId: 'dispatch-exhausted',
        uid: UID_A,
        ownershipVersion: 1,
        tokenHash: 'd'.repeat(64),
        receiptAttemptCount: 4,
      });
      const expo = fakeExpo({
        getReceipts: vi.fn(async () => new Map()),
      });

      const result = await runReceiptsReconciliation({
        db,
        expoClient: expo,
        now: () => now,
      });
      const parent = await db.collection(NOTIFICATION_DISPATCHES_COLLECTION)
        .doc('dispatch-exhausted').get();
      const delivery = await parent.ref.collection('deliveries').doc(INSTALLATION).get();

      expect(result.exhausted).toBe(1);
      expect(delivery.data()).toMatchObject({
        status: 'RECEIPT_EXHAUSTED',
        terminalReason: 'RECEIPT_TIMEOUT',
      });
      expect(parent.data()?.status).toBe('RECEIPT_EXHAUSTED');
      expect(parent.data()?.terminalReason).toBe('RECEIPT_EXHAUSTED');
    });

    it('records a terminal provider receipt error and updates the parent', async () => {
      await seedPendingReceipt({
        dispatchId: 'dispatch-provider-terminal',
        uid: UID_A,
        ownershipVersion: 1,
        tokenHash: 'e'.repeat(64),
      });
      const expo = fakeExpo({
        getReceipts: vi.fn(async (ids: string[]) => new Map(ids.map((id) => [
          id,
          { status: 'error', errorCode: 'InvalidCredentials' } as ExpoReceiptResult,
        ]))),
      });

      const result = await runReceiptsReconciliation({ db, expoClient: expo, now: () => now });
      const parent = await db.collection(NOTIFICATION_DISPATCHES_COLLECTION)
        .doc('dispatch-provider-terminal').get();

      expect(result.failedTerminal).toBe(1);
      expect(parent.data()).toMatchObject({
        status: 'FAILED_TERMINAL',
        terminalReason: 'ALL_DELIVERIES_FAILED',
      });
    });
  });
});
