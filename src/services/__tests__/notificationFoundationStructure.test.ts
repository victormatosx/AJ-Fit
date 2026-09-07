import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../../..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('push foundation structural boundaries', () => {
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

  it('registers no product notification type in the dispatcher contract', () => {
    const schema = read('functions/src/notifications/schema.ts');
    expect(schema).toContain("NOTIFICATION_TYPES = ['QA_TEST']");
    for (const type of [
      'WORKOUT_DAY',
      'MISSED_WORKOUT',
      'RE_ENGAGEMENT_EARLY',
      'RE_ENGAGEMENT_LATE',
      'RECOVERY_DAY',
      'EVOLUTION_UNLOCKED',
      'EVOLUTION_APPROACHING',
      'WEEK_COMPLETED',
      'WEEK_STREAK',
      'PROGRAM_UPDATED',
      'GOAL_PROXIMITY',
      'PHOTO_REMINDER',
      'ASSESSMENT_REMINDER',
      'COMPARE_PROGRESS',
      'BILLING_ISSUE',
      'PREMIUM_ENDED',
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
  });

  it('preserves current account-deletion workout descendant cleanup', () => {
    expect(read('functions/src/accountDeletion/firestoreCleanup/engine.ts'))
      .toContain('deleteUserWorkoutProgramDescendants');
  });
});
