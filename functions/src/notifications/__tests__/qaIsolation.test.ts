import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../../../..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('QA preview isolation boundaries', () => {
  it('has no imports or calls into product fact/state producers', () => {
    const source = read('functions/src/notifications/qaDispatch.ts');
    for (const forbidden of [
      'dailyProductRateLimit',
      'notificationProductWindows',
      'achievementMilestones',
      'workoutLifecycleNotifications',
      'dailyWorkoutNotifications',
      'revenueCatNotifications',
      'pendingEvolutions',
      'workoutExecutions',
      'subscriptions',
    ]) {
      expect(source).not.toContain(forbidden);
    }
    expect(source).toContain('dispatchNotification');
    expect(source).toContain("'QA_PREVIEW'");
    expect(source).not.toContain('exp.host');
  });

  it('keeps App Check enforced and accepts no arbitrary target or display copy', () => {
    const index = read('functions/src/index.ts');
    const handler = read('functions/src/notifications/qaDispatch.ts');
    expect(index).toMatch(/dispatchTestNotification = onCall\(\s*\{ enforceAppCheck: true \}/);
    expect(handler).toContain("'notificationType,qaRequestId'");
    expect(handler).not.toContain('targetUid');
    expect(handler).not.toContain('expoPushToken');
  });

  it('keeps the product rate-limit path outside the dispatcher used by QA', () => {
    const dispatcher = read('functions/src/notifications/dispatcher.ts');
    expect(dispatcher).not.toContain('notificationProductWindows');
    expect(dispatcher).not.toContain('claimDailyProductWindow');
  });

  it('preserves QA_PREVIEW mode when the existing retry scheduler replays a dispatch', () => {
    const retry = read('functions/src/notifications/retryScheduler.ts');
    expect(retry).toContain(
      'dispatchNotification(persisted.request, dependencies, persisted.dispatchMode)',
    );
  });
});
