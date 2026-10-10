import { Timestamp } from 'firebase-admin/firestore';
import { describe, expect, it, vi } from 'vitest';

import {
  buildNutritionDailyLogReminder,
  buildNutritionPlanReadyNotification,
  buildNutritionWeeklySummaryNotification,
} from '../contentPolicy';
import { evaluateNutritionNotification } from '../nutritionNotifications';

const now = Timestamp.fromDate(new Date('2026-10-05T12:00:00.000Z'));
const dailyContext = { allowed: true as const, timezone: 'America/Sao_Paulo', localDate: '2026-10-05',
  candidate: { notificationType: 'NUTRITION_DAILY_LOG_REMINDER' as const, localDate: '2026-10-05' } };

describe('nutrition notifications', () => {
  it('builds localized, category-scoped and idempotent daily/weekly/plan-ready requests', () => {
    const daily = buildNutritionDailyLogReminder({ uid: 'uid', localDate: '2026-10-05', locale: 'pt-BR' });
    const same = buildNutritionDailyLogReminder({ uid: 'uid', localDate: '2026-10-05', locale: 'en' });
    expect(daily.category).toBe('NUTRITION');
    expect(daily.idempotencyKey).toBe(same.idempotencyKey);
    expect(buildNutritionWeeklySummaryNotification({ uid: 'uid', weekStart: '2026-09-28', locale: 'es' }).type)
      .toBe('NUTRITION_WEEKLY_SUMMARY');
    expect(buildNutritionPlanReadyNotification({ uid: 'uid', generationId: 'generation', locale: 'en' }).type)
      .toBe('NUTRITION_PLAN_READY');
  });

  it('does not claim or dispatch when the nutrition preference is disabled', async () => {
    const claim = vi.fn();
    const dispatch = vi.fn();
    const result = await evaluateNutritionNotification('uid', {
      now: () => now,
      readContext: vi.fn().mockResolvedValue(dailyContext),
      resolvePolicy: vi.fn().mockResolvedValue({ allowed: false, reason: 'DISABLED_BY_USER' }),
      claimProductWindow: claim,
      dispatchCandidate: dispatch,
    });
    expect(result).toMatchObject({ status: 'SUPPRESSED', reason: 'DISABLED_BY_USER' });
    expect(claim).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('dispatches an eligible absent daily log and completes the shared daily slot', async () => {
    const complete = vi.fn().mockResolvedValue(true);
    const result = await evaluateNutritionNotification('uid', {
      now: () => now,
      readContext: vi.fn().mockResolvedValue(dailyContext),
      resolvePolicy: vi.fn().mockResolvedValue({ allowed: true, reason: 'ALLOWED' }),
      claimProductWindow: vi.fn().mockResolvedValue({ outcome: 'CLAIMED', windowId: 'window', claimToken: 'claim' }),
      completeProductWindow: complete,
      dispatchCandidate: vi.fn().mockResolvedValue({ status: 'CONFIRMED', dispatchId: 'dispatch', deviceCount: 1, acceptedCount: 1 }),
    });
    expect(result).toMatchObject({ status: 'DISPATCHED', notificationType: 'NUTRITION_DAILY_LOG_REMINDER' });
    expect(complete).toHaveBeenCalledOnce();
  });

  it('does not dispatch without a plan, with an existing log, without weekly data, or for inactive accounts', async () => {
    for (const reason of ['NO_ACTIVE_PLAN', 'DAILY_LOG_ALREADY_EXISTS', 'NO_WEEKLY_DATA', 'ACCOUNT_INACTIVE']) {
      const dispatch = vi.fn();
      const result = await evaluateNutritionNotification('uid', {
        now: () => now,
        readContext: vi.fn().mockResolvedValue({ allowed: false, reason }),
        dispatchCandidate: dispatch,
      });
      expect(result).toMatchObject({ status: 'SUPPRESSED', reason });
      expect(dispatch).not.toHaveBeenCalled();
    }
  });
});
