import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../../..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('push notification structural boundaries', () => {
  it('keeps RevenueCat bootstrap before React runtime composition', () => {
    const app = read('App.tsx');
    expect(app.indexOf('configureRevenueCat().catch')).toBeLessThan(
      app.indexOf('export default function App()'),
    );
    expect(app).toContain('<PushNotificationsRuntime />');
    expect(app).toContain('<PushDeviceRegistrationRuntime />');
  });

  it('keeps startup passive and permission contextual', () => {
    const runtime = read('src/components/PushNotificationsRuntime.tsx');
    expect(runtime).toContain('initializePushNotificationRuntime');
    expect(runtime).not.toContain('requestNotificationPermission()');
    const screen = read('src/screens/NotificationSettingsScreen.tsx');
    expect(screen).toContain('requestNotificationPermission()');
  });

  it('does not unregister the native token during logout/account switch', () => {
    const push = read('src/services/pushNotifications.ts');
    const auth = read('src/services/auth.ts');
    expect(push).not.toContain('unregisterForNotificationsAsync');
    expect(auth).toContain('void queueNotificationDeviceRelease(uid)');
    expect(auth).not.toContain('await queueNotificationDeviceRelease(uid)');
  });

  it('keeps Rest Timer and general push channels separate', () => {
    expect(read('src/services/pushNotifications.ts')).toContain(
      "GENERAL_NOTIFICATION_CHANNEL_ID = 'ajfit_general'",
    );
    expect(read('modules/ajfit-rest-activity/android/src/main/java/com/ajfit/restactivity/RestNotificationChannel.kt'))
      .toContain('rest_timer');
  });

  it('registers only QA_TEST and implemented Phase-2/Phase-3/Phase-4 product types', () => {
    const schema = read('functions/src/notifications/schema.ts');
    for (const type of [
      'QA_TEST',
      'EVOLUTION_UNLOCKED',
      'PROGRAM_UPDATED',
      'BILLING_ISSUE',
      'PREMIUM_ENDED',
      'WORKOUT_DAY',
      'RECOVERY_DAY',
      'MISSED_WORKOUT',
      'EVOLUTION_APPROACHING',
    ]) {
      expect(schema).toContain(`'${type}'`);
    }
    for (const type of [
      'RE_ENGAGEMENT_EARLY',
      'RE_ENGAGEMENT_LATE',
      'WEEK_COMPLETED',
      'WEEK_STREAK',
      'GOAL_PROXIMITY',
      'PHOTO_REMINDER',
      'ASSESSMENT_REMINDER',
      'COMPARE_PROGRESS',
    ]) {
      expect(schema).not.toContain(type);
    }
  });

  it('keeps Expo HTTP access centralized', () => {
    expect(read('functions/src/notifications/expoPushClient.ts')).toContain(
      'https://exp.host/--/api/v2/push/send',
    );
    expect(read('functions/src/notifications/dispatcher.ts')).not.toContain('exp.host');
    expect(read('functions/src/notifications/qaDispatch.ts')).not.toContain('exp.host');
    expect(read('functions/src/notifications/workoutLifecycleNotifications.ts'))
      .not.toContain('exp.host');
    expect(read('functions/src/notifications/revenueCatNotifications.ts'))
      .not.toContain('exp.host');
    expect(read('functions/src/notifications/dailyWorkoutNotifications.ts'))
      .not.toContain('exp.host');
    expect(read('functions/src/notifications/dailyScheduler.ts'))
      .not.toContain('exp.host');
    expect(read('functions/src/notifications/evolutionApproachingNotification.ts'))
      .not.toContain('exp.host');
  });

  it('connects product candidates only after their persisted business facts', () => {
    const lifecycle = read('functions/src/telemetry/trustedWorkoutLifecycleTelemetry.ts');
    expect(lifecycle.indexOf('emitTrustedWorkoutLifecycleTelemetry(lifecycleEvent'))
      .toBeLessThan(lifecycle.indexOf('dispatchWorkoutLifecycleNotification({'));

    const revenueCat = read('functions/src/billing/revenuecat.ts');
    expect(revenueCat.lastIndexOf('applySubscriptionEventAtomically('))
      .toBeLessThan(revenueCat.lastIndexOf('dispatchRevenueCatNotificationAfterSubscription({'));
  });

  it('preserves current account-deletion workout descendant cleanup', () => {
    expect(read('functions/src/accountDeletion/firestoreCleanup/engine.ts'))
      .toContain('deleteUserWorkoutProgramDescendants');
  });
});
