import { buildNutritionPlanReadyNotification } from '../contentPolicy';
import { claimDispatch } from '../idempotency';
import { randomUUID } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';

import { db } from '../../lib/firebaseAdmin';
import { readNutritionNotificationContext } from '../nutritionNotificationContext';
import { dispatchNutritionPlanReady } from '../nutritionNotifications';

const mondayMorning = Timestamp.fromDate(new Date('2026-10-05T12:00:00.000Z'));

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('nutrition notifications (emulator)', () => {
  it('derives weekly/daily candidates from real bounded facts and fences inactive accounts', async () => {
    const uid = `nutrition-notification-${randomUUID()}`;
    const root = db.collection('users').doc(uid);
    await root.set({ preferences: { language: 'pt-BR', notificationPreferences: { nutrition: true } } });
    await root.collection('workoutProgramState').doc('scheduleConfig').set({ timezone: 'America/Sao_Paulo' });
    await root.collection('nutritionPlans').doc('plan').set({ status: 'active', generationId: 'plan' });
    await db.collection('nutritionRolloutConfig').doc('active').set({
      nutritionEnabled: { schemaVersion: 1, enabled: true, percentage: 100 },
      nutritionPlanGenerationEnabled: { schemaVersion: 1, enabled: true, percentage: 100 },
    });
    await root.collection('nutritionDailyLogs').doc('2026-10-01').set({ loggedItemCount: 1 });

    await expect(readNutritionNotificationContext(db, uid, mondayMorning)).resolves.toMatchObject({
      allowed: true,
      candidate: { notificationType: 'NUTRITION_WEEKLY_SUMMARY', weekStart: '2026-09-28' },
      timezone: 'America/Sao_Paulo',
    });

    await root.collection('nutritionDailyLogs').doc('2026-10-01').delete();
    await expect(readNutritionNotificationContext(db, uid, mondayMorning)).resolves.toMatchObject({
      allowed: true,
      candidate: { notificationType: 'NUTRITION_DAILY_LOG_REMINDER', localDate: '2026-10-05' },
    });
    await root.collection('nutritionDailyLogs').doc('2026-10-05').set({ loggedItemCount: 1 });
    await expect(readNutritionNotificationContext(db, uid, mondayMorning)).resolves.toMatchObject({
      allowed: false, reason: 'DAILY_LOG_ALREADY_EXISTS',
    });

    await db.collection('accountDeletionLocks').doc(uid).set({ status: 'REQUESTED' });
    await expect(readNutritionNotificationContext(db, uid, mondayMorning)).resolves.toMatchObject({
      allowed: false, reason: 'ACCOUNT_INACTIVE',
    });
  });

  it('sends plan-ready only after the active plan exists and deduplicates the generation', async () => {
    const uid = `nutrition-plan-ready-${randomUUID()}`;
    const generationId = randomUUID();
    const root = db.collection('users').doc(uid);
    await root.set({ preferences: { language: 'en', notificationPreferences: { nutrition: true } } });
    await db.collection('nutritionRolloutConfig').doc('active').set({
      nutritionEnabled: { schemaVersion: 1, enabled: true, percentage: 100 },
      nutritionPlanGenerationEnabled: { schemaVersion: 1, enabled: true, percentage: 100 },
    });
    await root.collection('workoutProgramState').doc('scheduleConfig').set({ timezone: 'America/Sao_Paulo' });
    await root.collection('nutritionGenerationJobs').doc(generationId).set({
      status: 'completed', planId: generationId,
    });
    expect(await dispatchNutritionPlanReady(uid, generationId, db, mondayMorning)).toBeNull();
    await root.collection('nutritionPlans').doc(generationId).set({
      status: 'active', generationId,
    });
    await expect(dispatchNutritionPlanReady(uid, generationId, db, mondayMorning))
      .resolves.toMatchObject({ status: 'NO_ELIGIBLE_DEVICE' });
    await expect(dispatchNutritionPlanReady(uid, generationId, db, mondayMorning))
      .resolves.toMatchObject({ status: 'DUPLICATE' });
  });
  it('deduplicates replays with additive routing fields against the historical semantic hash', async () => {
    const uid = `nutrition-historical-${randomUUID()}`;
    const current = buildNutritionPlanReadyNotification({ uid, generationId: randomUUID(), locale: 'pt-BR', initialOnboarding: true });
    const old = { ...current, data: { generationId: current.data!.generationId } };
    await claimDispatch(db, old, mondayMorning);
    expect((await claimDispatch(db, current, mondayMorning)).outcome).toBe('DUPLICATE_IN_PROGRESS');
    const malicious = { ...current, data: { ...current.data, recipientUid: 'someone-else' } };
    await expect(claimDispatch(db, malicious, mondayMorning)).rejects.toThrow('notification_idempotency_contract_conflict');
  });
  it('defers a completed first diet through quiet hours using the existing retry queue', async () => {
    const uid = `nutrition-quiet-${randomUUID()}`;
    const generationId = randomUUID();
    const root = db.collection('users').doc(uid);
    await root.set({ preferences: { language: 'pt-BR' } });
    await root.collection('workoutProgramState').doc('scheduleConfig').set({ timezone: 'America/Sao_Paulo' });
    await root.collection('nutritionGenerationJobs').doc(generationId).set({ status: 'completed', planId: generationId, initialOnboarding: true });
    await root.collection('nutritionPlans').doc(generationId).set({ status: 'active', generationId });
    const night = Timestamp.fromDate(new Date('2026-10-05T03:00:00.000Z'));
    const deferred = await dispatchNutritionPlanReady(uid, generationId, db, night);
    expect(deferred?.status).toBe('DUPLICATE');
    const queued = await db.collection('notificationDispatches').doc(deferred!.dispatchId).get();
    expect(queued.get('status')).toBe('RETRY_SCHEDULED');
    expect(queued.get('attemptCount')).toBe(0);
    expect(queued.get('nextAttemptAt').toMillis()).toBeGreaterThan(night.toMillis());
    expect(queued.get('request.data.initialOnboarding')).toBe('true');
    expect(queued.get('request.title')).toBe('Sua dieta está pronta!');
    expect(await dispatchNutritionPlanReady(uid, generationId, db, mondayMorning)).toMatchObject({ status: 'NO_ELIGIBLE_DEVICE' });
  });

});
