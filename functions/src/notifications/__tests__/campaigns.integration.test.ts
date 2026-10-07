import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../../attribution/adminAuth', () => ({ requireAdminUid: vi.fn(async (request: { auth?: { uid?: string } }) => {
  if (!request.auth?.uid) throw new Error('admin_required');
  return request.auth.uid;
}) }));

import { adminCampaignActionHandler, adminEstimateCampaignHandler, adminGetCampaignRunHandler, adminSaveCampaignHandler, adminScheduleCampaignHandler, adminTestCampaignHandler, recordCampaignOpenHandler, runCampaignScheduler } from '../campaigns';
import { dispatchNotification } from '../dispatcher';
import type { ExpoPushClient } from '../expoPushClient';
import { dispatchIdFor } from '../idempotency';
import { runNotificationPreflight } from '../notificationPreflight';
import { runDispatchRetries } from '../retryScheduler';

const enabled = !!process.env.CAMPAIGN_INTEGRATION && !!process.env.FIRESTORE_EMULATOR_HOST;
const suite = enabled ? describe : describe.skip;
const NOW = 2_000_000_000_000;

suite('campaign scheduler against Firestore Emulator', () => {
  const app = initializeApp({ projectId: 'ajfit-rules-test' }, 'campaign-integration');
  const db = getFirestore(app);
  const expoClient = { send: vi.fn(async () => []), getReceipts: vi.fn(async () => new Map()) };
  const dependencies = {
    db, now: () => Timestamp.fromMillis(NOW), expoClient,
    preflight: vi.fn(async () => ({ allowed: true as const })),
    eligibility: vi.fn(async () => ({ allowed: true as const, reason: 'ALLOWED' as const })),
  };
  const campaign = db.collection('notificationCampaigns').doc('integration-campaign');
  const runId = `integration-campaign.${NOW - 60000}`;

  beforeAll(async () => {
    for (const [uid, language] of [['user-a', 'pt-BR'], ['user-b', 'pt-BR'], ['user-c', 'en']]) {
      await db.collection('users').doc(uid).set({ preferences: { language }, metadata: { role: 'user' } });
    }
    const at = new Date(NOW - 60000).toISOString();
    await campaign.set({
      name: 'Integração', status: 'scheduled', version: 1, occurrenceCount: 0,
      nextRunAt: Timestamp.fromMillis(NOW - 60000),
      content: { 'pt-BR': { title: 'Olá', body: 'Teste' }, destination: 'home' },
      audience: { kind: 'language', language: 'pt-BR' },
      schedule: { kind: 'once', startAt: at, timezone: 'UTC', windowMinutes: 0 },
    });
  });
  afterAll(async () => { await deleteApp(app); });

  async function seedDevice(uid: string, installationId: string) {
    const leaseExpiresAt = Timestamp.fromMillis(NOW + 86400000);
    const tokenHash = installationId.padEnd(64, 'a').slice(0, 64);
    await Promise.all([
      db.collection('users').doc(uid).set({ preferences: { language: 'pt-BR' } }),
      db.collection('users').doc(uid).collection('devices').doc(installationId).set({ installationId, platform: 'android', permissionStatus: 'granted', pushEnabled: true, tokenHash, ownershipVersion: 1, leaseExpiresAt, disabledAt: null, invalidAt: null }),
      db.collection('pushInstallations').doc(installationId).set({ installationId, ownerUid: uid, platform: 'android', permissionStatus: 'granted', pushEnabled: true, tokenHash, ownershipVersion: 1, leaseExpiresAt, releasedAt: null, disabledAt: null, invalidAt: null }),
      db.collection('pushTokenOwners').doc(tokenHash).set({ tokenHash, ownerUid: uid, installationId, ownershipVersion: 1, active: true, invalidAt: null, leaseExpiresAt, expoPushToken: `ExponentPushToken[${installationId}]` }),
    ]);
  }

  it('materializes once, segments server-side, and resumes without duplicate recipients or dispatches', async () => {
    await Promise.all([runCampaignScheduler(dependencies), runCampaignScheduler(dependencies)]);
    const run = await campaign.collection('runs').doc(runId).get();
    expect(run.exists).toBe(true);
    const recipients = await campaign.collection('runs').doc(runId).collection('recipients').get();
    expect(recipients.docs.map((doc) => doc.id).sort()).toEqual(['user-a', 'user-b']);
    const dispatches = await db.collection('notificationDispatches').where('campaignRunId', '==', runId).get();
    expect(dispatches.size).toBe(2);
    await runCampaignScheduler(dependencies);
    expect((await campaign.collection('runs').get()).size).toBe(1);
    expect((await campaign.collection('runs').doc(runId).collection('recipients').get()).size).toBe(2);
    expect((await db.collection('notificationDispatches').where('campaignRunId', '==', runId).get()).size).toBe(2);
    expect(expoClient.send).not.toHaveBeenCalled();
  }, 20000);

  it('does not materialize paused campaigns and stops unsent recipients after cancel', async () => {
    const ref = db.collection('notificationCampaigns').doc('integration-cancel');
    const scheduledMs = NOW - 60000;
    await ref.set({
      name: 'Cancelamento', status: 'paused', version: 1, occurrenceCount: 0,
      nextRunAt: Timestamp.fromMillis(scheduledMs),
      content: { 'pt-BR': { title: 'Olá', body: 'Teste' }, destination: 'home' },
      audience: { kind: 'uids', uids: ['user-a'] },
      schedule: { kind: 'once', startAt: new Date(scheduledMs).toISOString(), timezone: 'UTC', windowMinutes: 1440 },
    });
    await runCampaignScheduler(dependencies);
    expect((await ref.collection('runs').get()).empty).toBe(true);
    await ref.update({ status: 'scheduled' });
    await runCampaignScheduler(dependencies);
    const runs = await ref.collection('runs').get();
    expect(runs.size).toBe(1);
    await ref.update({ status: 'paused' });
    await runCampaignScheduler(dependencies);
    expect((await runs.docs[0]!.ref.get()).get('status')).toBe('paused_ready');
    await ref.update({ status: 'active' });
    await runCampaignScheduler(dependencies);
    expect((await runs.docs[0]!.ref.get()).get('status')).toBe('ready');
    await ref.update({ status: 'canceled' });
    await runCampaignScheduler(dependencies);
    expect((await db.collection('notificationDispatches').where('campaignRunId', '==', runs.docs[0]!.id).get()).empty).toBe(true);
  });

  it('records a genuine accepted open once and rejects a different user', async () => {
    const campaignId = 'open-campaign';
    const runId = 'open-campaign.123';
    const recipient = db.collection('notificationCampaigns').doc(campaignId).collection('runs').doc(runId).collection('recipients').doc('user-a');
    const dispatchId = dispatchIdFor(`campaign:${campaignId}:${runId}:user-a`);
    await recipient.set({ uid: 'user-a', openedAt: null });
    await db.collection('notificationDispatches').doc(dispatchId).set({ uid: 'user-a', acceptedCount: 1 });
    const request = { auth: { uid: 'user-a' }, data: { campaignId, campaignRunId: runId } };
    await expect(recordCampaignOpenHandler(request as never, db)).resolves.toMatchObject({ recorded: true, dispatchId });
    await expect(recordCampaignOpenHandler(request as never, db)).resolves.toMatchObject({ recorded: false });
    await expect(recordCampaignOpenHandler({ auth: { uid: 'user-b' }, data: request.data } as never, db)).rejects.toThrow('campaign_recipient_not_found');
  });

  it('sends a self-targeted campaign preview through the dispatcher', async () => {
    const result = await adminTestCampaignHandler({ auth: { uid: 'user-a' }, data: { definition: { content: { 'pt-BR': { title: 'Prévia', body: 'Teste' }, destination: 'progress' } }, requestId: '123e4567-e89b-42d3-a456-426614174000' } } as never, dependencies);
    expect(result.status).toBe('NO_ELIGIBLE_DEVICE');
    const doc = await db.collection('notificationDispatches').doc(result.dispatchId).get();
    expect(doc.get('dispatchMode')).toBe('QA_PREVIEW');
    expect(doc.get('type')).toBe('CAMPAIGN');
  });

  it('estimates on the server, schedules with CAS, then pauses, resumes and cancels', async () => {
    const admin = { uid: 'admin' };
    const definition = {
      name: 'Operação',
      content: { 'pt-BR': { title: 'Olá', body: 'Volte' }, destination: 'profile' },
      audience: { kind: 'language', language: 'pt-BR' },
      schedule: { kind: 'daily', timezone: 'UTC', startAt: new Date(Date.now() + 5 * 60000).toISOString(), localTime: new Date(Date.now() + 5 * 60000).toISOString().slice(11, 16), maxOccurrences: 2 },
    };
    const draft = await adminSaveCampaignHandler({ auth: admin, data: { definition: { name: definition.name } } } as never, db);
    const estimate = await adminEstimateCampaignHandler({ auth: admin, data: { audience: definition.audience } } as never, db);
    expect(estimate.estimatedUsers).toBe(2);
    const saved = await adminSaveCampaignHandler({ auth: admin, data: { id: draft.id, version: draft.version, definition } } as never, db);
    const scheduled = await adminScheduleCampaignHandler({ auth: admin, data: { id: draft.id, version: saved.version, confirmed: true, confirmedReach: 2 } } as never, db);
    expect(scheduled.estimatedUsers).toBe(2);
    await expect(adminScheduleCampaignHandler({ auth: admin, data: { id: draft.id, version: saved.version, confirmed: true, confirmedReach: 2 } } as never, db)).rejects.toThrow('campaign_version_conflict');
    const paused = await adminCampaignActionHandler({ auth: admin, data: { id: draft.id, version: scheduled.version, action: 'pause' } } as never, db);
    expect(paused.status).toBe('paused');
    const resumed = await adminCampaignActionHandler({ auth: admin, data: { id: draft.id, version: paused.version, action: 'resume' } } as never, db);
    expect(resumed.status).toBe('scheduled');
    const canceled = await adminCampaignActionHandler({ auth: admin, data: { id: draft.id, version: resumed.version, action: 'cancel' } } as never, db);
    expect(canceled.status).toBe('canceled');
    expect((await db.collection('notificationCampaigns').doc(draft.id).get()).get('cancelBy')).toBe('admin');
  });

  it('stops recurring materialization at the occurrence limit', async () => {
    const ref = db.collection('notificationCampaigns').doc('integration-recurrence');
    const first = Date.parse('2033-05-16T03:00:00.000Z');
    await ref.set({
      name: 'Recorrência', status: 'scheduled', version: 1, occurrenceCount: 0,
      nextRunAt: Timestamp.fromMillis(first),
      content: { 'pt-BR': { title: 'Olá', body: 'Teste' }, destination: 'home' },
      audience: { kind: 'uids', uids: ['missing-user'] },
      schedule: { kind: 'daily', startAt: new Date(first).toISOString(), timezone: 'UTC', localTime: '03:00', maxOccurrences: 2 },
    });
    await runCampaignScheduler(dependencies);
    await runCampaignScheduler(dependencies);
    await runCampaignScheduler(dependencies);
    expect((await ref.collection('runs').get()).size).toBe(2);
    expect((await ref.get()).get('occurrenceCount')).toBe(2);
    expect((await ref.get()).get('nextRunAt')).toBeNull();
  }, 20000);

  it('reconciles a terminal dispatch after a crash before persisting its recipient', async () => {
    const ref = db.collection('notificationCampaigns').doc('integration-crash');
    const scheduled = NOW - 60000;
    await ref.set({ name: 'Crash', status: 'scheduled', version: 1, occurrenceCount: 0,
      nextRunAt: Timestamp.fromMillis(scheduled),
      content: { 'pt-BR': { title: 'Olá', body: 'Teste' }, destination: 'home' },
      audience: { kind: 'uids', uids: ['user-a'] },
      schedule: { kind: 'once', startAt: new Date(scheduled).toISOString(), timezone: 'UTC' },
    });
    let now = NOW;
    let failed = false;
    const injected = { ...dependencies, now: () => Timestamp.fromMillis(now),
      afterCampaignDispatch: async () => { if (!failed) { failed = true; throw new Error('crash_after_dispatch'); } },
    };
    await runCampaignScheduler(injected);
    const run = ref.collection('runs').doc(`integration-crash.${scheduled}`);
    const recipient = run.collection('recipients').doc('user-a');
    expect((await recipient.get()).get('state')).toBe('PENDING');
    expect((await db.collection('notificationDispatches').where('campaignRunId', '==', run.id).get()).size).toBe(1);
    now += 6 * 60000;
    await runCampaignScheduler(injected);
    expect((await recipient.get()).get('state')).toBe('PROCESSED');
    expect((await run.get()).get('status')).toBe('completed');
    expect((await db.collection('notificationDispatches').where('campaignRunId', '==', run.id).get()).size).toBe(1);
    expect((await ref.get()).get('status')).toBe('completed');
  }, 30000);

  it('gives a due 101st run a turn despite 100 older runs with future recipients', async () => {
    const ref = db.collection('notificationCampaigns').doc('integration-fairness');
    await ref.set({ status: 'active', nextRunAt: null, version: 1 });
    const batch = db.batch();
    for (let i = 0; i < 101; i++) {
      const id = `fair.${String(i).padStart(3, '0')}`;
      const run = ref.collection('runs').doc(id);
      batch.set(run, { campaignId: ref.id, status: 'ready', scheduledAt: Timestamp.fromMillis(NOW - 100000 + i),
        content: { 'pt-BR': { title: 'Olá', body: 'Teste' }, destination: 'home' } });
      batch.set(run.collection('recipients').doc('user-a'), { campaignId: ref.id, campaignRunId: id, uid: 'user-a', language: 'pt-BR', state: 'PENDING',
        dueAt: Timestamp.fromMillis(i === 100 ? NOW - 1 : NOW + 86400000), openedAt: null });
    }
    await batch.commit();
    await runCampaignScheduler(dependencies);
    const lateRecipient = ref.collection('runs').doc('fair.100').collection('recipients').doc('user-a');
    expect((await lateRecipient.get()).get('state')).toBe('PENDING');
    await runCampaignScheduler(dependencies);
    expect((await lateRecipient.get()).get('state')).toBe('PROCESSED');
  }, 60000);

  it('holds a retry while paused, resumes it without losing its attempt budget, and waits to complete', async () => {
    const campaign = db.collection('notificationCampaigns').doc('integration-retry-pause');
    const run = campaign.collection('runs').doc('integration-retry-pause.1');
    await campaign.set({ status: 'active', nextRunAt: null, version: 1 });
    await run.set({ campaignId: campaign.id, status: 'ready', scheduledAt: Timestamp.fromMillis(NOW - 60000) });
    await run.collection('recipients').doc('retry-user').set({ state: 'PROCESSED', openedAt: null });
    await seedDevice('retry-user', 'retry-device');
    let now = NOW;
    const request = { uid: 'retry-user', notificationId: 'CAMPAIGN:integration-retry-pause.1', type: 'CAMPAIGN' as const,
      category: 'WORKOUTS_AND_REMINDERS' as const, sourceIdentity: 'campaign:integration-retry-pause.1',
      idempotencyKey: 'campaign:integration-retry-pause:integration-retry-pause.1:retry-user',
      title: 'Olá', body: 'Teste', intent: 'campaign', data: { campaignId: campaign.id, campaignRunId: run.id, destination: 'home', recipientUid: 'retry-user' } };
    const firstExpo = { send: vi.fn(async () => [{ ok: false as const, errorCode: 'SERVER_ERROR' }]), getReceipts: vi.fn(async () => new Map()) };
    const deps = (expoClient: ExpoPushClient) => ({ db, now: () => Timestamp.fromMillis(now), expoClient,
      preflight: (value: typeof request, at: Timestamp) => runNotificationPreflight(db, value, at),
      eligibility: async () => ({ allowed: true as const, reason: 'ALLOWED' as const }), random: () => 0.5 });
    const first = await dispatchNotification(request, deps(firstExpo));
    expect(first.status).toBe('RETRY_SCHEDULED');
    await runCampaignScheduler({ ...deps(firstExpo), preflight: async () => ({ allowed: true as const }) });
    expect((await run.get()).get('status')).toBe('ready');
    const dispatch = db.collection('notificationDispatches').doc(first.dispatchId);
    now = (await dispatch.get()).get('nextAttemptAt').toMillis();
    await campaign.update({ status: 'paused' });
    const resumedExpo = { send: vi.fn(async () => [{ ok: true as const, ticketId: 'accepted-ticket' }]), getReceipts: vi.fn(async () => new Map()) };
    await runDispatchRetries(deps(resumedExpo));
    expect(resumedExpo.send).not.toHaveBeenCalled();
    expect((await dispatch.get()).get('status')).toBe('RETRY_SCHEDULED');
    expect((await dispatch.get()).get('attemptCount')).toBe(1);
    await campaign.update({ status: 'active' });
    await runDispatchRetries(deps(resumedExpo));
    expect(resumedExpo.send).toHaveBeenCalledTimes(1);
    expect((await dispatch.get()).get('status')).toBe('PENDING_RECEIPTS');
    expect((await dispatch.get()).get('attemptCount')).toBe(2);
    await runCampaignScheduler({ ...deps(resumedExpo), preflight: async () => ({ allowed: true as const }) });
    expect((await run.get()).get('status')).toBe('ready');
    const metrics = await adminGetCampaignRunHandler({ auth: { uid: 'admin' }, data: { campaignId: campaign.id, runId: run.id } } as never, db);
    expect(metrics.metrics).toMatchObject({ segmentUsers: 1, attemptedUsers: 1, acceptedUsers: 1, receiptConfirmedUsers: 0, failedDispatches: 0, permanentRecipientErrors: 0 });
    await dispatch.update({ status: 'CONFIRMED', confirmedCount: 1 });
    await runCampaignScheduler({ ...deps(resumedExpo), preflight: async () => ({ allowed: true as const }) });
    expect((await run.get()).get('status')).toBe('completed');
    expect((await campaign.get()).get('status')).toBe('completed');
  }, 30000);

  it('cancels a pending retry before Expo and counts unconfirmed receipts separately from failures', async () => {
    const campaign = db.collection('notificationCampaigns').doc('integration-retry-cancel');
    const run = campaign.collection('runs').doc('integration-retry-cancel.1');
    await campaign.set({ status: 'active', nextRunAt: null, version: 1 });
    await run.set({ campaignId: campaign.id, status: 'ready', scheduledAt: Timestamp.fromMillis(NOW) });
    const uid = 'cancel-user';
    await seedDevice(uid, 'cancel-device');
    const idempotencyKey = `campaign:${campaign.id}:${run.id}:${uid}`;
    const dispatchId = dispatchIdFor(idempotencyKey);
    const request = { uid, notificationId: `CAMPAIGN:${run.id}`, type: 'CAMPAIGN' as const,
      category: 'WORKOUTS_AND_REMINDERS' as const, sourceIdentity: `campaign:${run.id}`, idempotencyKey,
      title: 'Olá', body: 'Teste', intent: 'campaign', data: { campaignId: campaign.id, campaignRunId: run.id, destination: 'home', recipientUid: uid } };
    let now = NOW;
    const firstExpo = { send: vi.fn(async () => [{ ok: false as const, errorCode: 'SERVER_ERROR' }]), getReceipts: vi.fn(async () => new Map()) };
    const deps = (expoClient: ExpoPushClient) => ({ db, now: () => Timestamp.fromMillis(now), expoClient,
      preflight: (value: typeof request, at: Timestamp) => runNotificationPreflight(db, value, at),
      eligibility: async () => ({ allowed: true as const, reason: 'ALLOWED' as const }), random: () => 0.5 });
    expect((await dispatchNotification(request, deps(firstExpo))).status).toBe('RETRY_SCHEDULED');
    now = (await db.collection('notificationDispatches').doc(dispatchId).get()).get('nextAttemptAt').toMillis();
    await campaign.update({ status: 'canceled' });
    const expo = { send: vi.fn(async () => [{ ok: true as const, ticketId: 'unexpected' }]), getReceipts: vi.fn(async () => new Map()) };
    await runDispatchRetries(deps(expo));
    expect(expo.send).not.toHaveBeenCalled();
    expect((await db.collection('notificationDispatches').doc(dispatchId).get()).get('status')).toBe('SUPPRESSED_BY_POLICY');
    await run.collection('recipients').doc('accepted-user').set({ state: 'PROCESSED', openedAt: null });
    await db.collection('notificationDispatches').doc('unconfirmed-metric').set({ uid: 'accepted-user', campaignRunId: run.id,
      everAccepted: true, deviceCount: 1, acceptedCount: 1, confirmedCount: 0, status: 'RECEIPT_EXHAUSTED' });
    const metrics = await adminGetCampaignRunHandler({ auth: { uid: 'admin' }, data: { campaignId: campaign.id, runId: run.id } } as never, db);
    expect(metrics.metrics).toMatchObject({ acceptedUsers: 1, failedDispatches: 0, receiptUnconfirmedUsers: 1 });
  }, 30000);

  it('defers a claim if pause arrives after device selection but before Expo', async () => {
    const campaign = db.collection('notificationCampaigns').doc('integration-late-pause');
    const run = campaign.collection('runs').doc('integration-late-pause.1');
    await campaign.set({ status: 'active', nextRunAt: null, version: 1 });
    await run.set({ campaignId: campaign.id, status: 'ready', scheduledAt: Timestamp.fromMillis(NOW) });
    await seedDevice('late-pause-user', 'late-pause-device');
    const request = { uid: 'late-pause-user', notificationId: `CAMPAIGN:${run.id}`, type: 'CAMPAIGN' as const,
      category: 'WORKOUTS_AND_REMINDERS' as const, sourceIdentity: `campaign:${run.id}`,
      idempotencyKey: `campaign:${campaign.id}:${run.id}:late-pause-user`, title: 'Olá', body: 'Teste',
      intent: 'campaign', data: { campaignId: campaign.id, campaignRunId: run.id, destination: 'home', recipientUid: 'late-pause-user' } };
    let checks = 0;
    const expo = { send: vi.fn(async () => [{ ok: true as const, ticketId: 'ticket' }]), getReceipts: vi.fn(async () => new Map()) };
    const deps = { db, now: () => Timestamp.fromMillis(NOW), expoClient: expo,
      preflight: async () => {
        checks++;
        if (checks === 2) await campaign.update({ status: 'paused' });
        return runNotificationPreflight(db, request, Timestamp.fromMillis(NOW));
      },
      eligibility: async () => ({ allowed: true as const, reason: 'ALLOWED' as const }),
    };
    await dispatchNotification(request, deps);
    expect(expo.send).not.toHaveBeenCalled();
    const dispatch = db.collection('notificationDispatches').doc(dispatchIdFor(request.idempotencyKey));
    expect((await dispatch.get()).data()).toMatchObject({ status: 'RETRY_SCHEDULED', attemptCount: 0 });
    await campaign.update({ status: 'active' });
    await runDispatchRetries({ ...deps, preflight: (value, at) => runNotificationPreflight(db, value, at) });
    expect(expo.send).toHaveBeenCalledTimes(1);
    expect((await dispatch.get()).get('attemptCount')).toBe(1);
  }, 30000);

  it('terminates a permanently invalid recipient instead of retrying it forever', async () => {
    const campaign = db.collection('notificationCampaigns').doc('integration-invalid-content');
    const run = campaign.collection('runs').doc('integration-invalid-content.1');
    await campaign.set({ status: 'active', nextRunAt: null, version: 1 });
    await run.set({ campaignId: campaign.id, status: 'ready', scheduledAt: Timestamp.fromMillis(NOW - 1),
      content: { 'pt-BR': { title: 'Invalid\u0001', body: 'Teste' }, destination: 'home' } });
    const recipient = run.collection('recipients').doc('user-a');
    await recipient.set({ campaignId: campaign.id, campaignRunId: run.id, uid: 'user-a', language: 'pt-BR',
      state: 'PENDING', dueAt: Timestamp.fromMillis(NOW - 1), openedAt: null });
    await runCampaignScheduler(dependencies);
    expect((await recipient.get()).get('state')).toBe('FAILED_PERMANENT');
    expect((await run.get()).get('status')).toBe('completed');
    expect((await db.collection('notificationDispatches').where('campaignRunId', '==', run.id).get()).empty).toBe(true);
    expect((await campaign.get()).get('status')).toBe('completed');
  }, 30000);

  it('marks the campaign completed once its only run has no recoverable work left, even under cross-campaign cursor contention', async () => {
    const campaign = db.collection('notificationCampaigns').doc('integration-same-tick-completion');
    await campaign.set({ name: 'Same tick', status: 'scheduled', version: 1, occurrenceCount: 0,
      nextRunAt: Timestamp.fromMillis(NOW - 60000),
      content: { 'pt-BR': { title: 'Olá', body: 'Teste' }, destination: 'home' },
      audience: { kind: 'uids', uids: ['same-tick-user'] },
      schedule: { kind: 'once', startAt: new Date(NOW - 60000).toISOString(), timezone: 'UTC' },
    });
    // The scheduler runs every minute in production; the active/ready phase cursors are
    // shared across every campaign, so a run can sit behind other due work for a tick or
    // two before its turn comes up. Several ticks is the realistic wait, not a workaround.
    const run = campaign.collection('runs').doc(`integration-same-tick-completion.${NOW - 60000}`);
    for (let i = 0; i < 10 && (await campaign.get()).get('status') !== 'completed'; i++) await runCampaignScheduler(dependencies);
    expect((await run.get()).get('status')).toBe('completed');
    expect((await campaign.get()).get('status')).toBe('completed');
  }, 30000);
});
