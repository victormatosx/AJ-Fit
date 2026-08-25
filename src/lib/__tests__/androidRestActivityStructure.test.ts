import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const moduleSource = readFileSync(
  'modules/ajfit-rest-activity/android/src/main/java/com/ajfit/restactivity/AJFitRestActivityModule.kt',
  'utf8',
);
const builderSource = readFileSync(
  'modules/ajfit-rest-activity/android/src/main/java/com/ajfit/restactivity/RestNotificationBuilder.kt',
  'utf8',
);
const channelSource = readFileSync(
  'modules/ajfit-rest-activity/android/src/main/java/com/ajfit/restactivity/RestNotificationChannel.kt',
  'utf8',
);
const nativeSources = `${moduleSource}\n${builderSource}\n${channelSource}`;
const appConfig = JSON.parse(readFileSync('app.json', 'utf8')) as {
  expo: { android: { permissions?: string[] } };
};

describe('AJFitRestActivity Expo module', () => {
  it('registers the existing facade contract as an Android-only optional module', () => {
    const config = JSON.parse(
      readFileSync('modules/ajfit-rest-activity/expo-module.config.json', 'utf8'),
    ) as { platforms: string[]; android: { modules: string[] } };

    expect(config.platforms).toEqual(['android']);
    expect(config.android.modules).toEqual([
      'com.ajfit.restactivity.AJFitRestActivityModule',
    ]);
    expect(moduleSource).toContain('Name("AJFitRestActivity")');
    expect(moduleSource).toContain('Function("getCapabilities")');
    expect(moduleSource).toContain('AsyncFunction("start")');
    expect(moduleSource).toContain('AsyncFunction("update")');
    expect(moduleSource).toContain('AsyncFunction("end")');
    expect(moduleSource).toContain('"android-notification"');
  });

  it('declares POST_NOTIFICATIONS through Expo app config', () => {
    expect(appConfig.expo.android.permissions).toContain(
      'android.permission.POST_NOTIFICATIONS',
    );
    expect(moduleSource).toContain('Manifest.permission.POST_NOTIFICATIONS');
    expect(moduleSource).toContain('permissions.askForPermissions(');
    expect(moduleSource).toContain('PERMISSION_REQUESTED_KEY');
  });
});

describe('Android rest countdown notification', () => {
  it('uses one ongoing native countdown driven by the absolute endsAt', () => {
    expect(builderSource).toContain('setWhen(state.endsAt)');
    expect(builderSource).toContain('setUsesChronometer(true)');
    expect(builderSource).toContain('setChronometerCountDown(true)');
    expect(builderSource).toContain('setOngoing(true)');
    expect(builderSource).toContain('setTimeoutAfter(');
    expect(builderSource).not.toContain('remainingSeconds');
  });

  it('posts, updates and cancels the same constant notification id', () => {
    expect(builderSource).toMatch(/REST_NOTIFICATION_ID\s*=\s*41_704/);
    expect(moduleSource).toContain(
      'manager.notify(REST_NOTIFICATION_ID, notification)',
    );
    expect(moduleSource).toContain('.cancel(REST_NOTIFICATION_ID)');
  });

  it('keeps transition-only runtime diagnostics for the native pipeline', () => {
    for (const marker of [
      'module_available',
      'capabilities',
      'start_received',
      'permission_state',
      'permission_request_attempted',
      'permission_request_result',
      'notification_build',
      'notify_called',
      'notify_success',
      'active_notification_found',
      'notify_error',
    ]) {
      expect(nativeSources).toContain(marker);
    }
    expect(nativeSources).not.toContain('sessionId=${state.sessionId}');
    expect(nativeSources).not.toContain('exerciseName=${state.exerciseName}');
  });

  it('creates the stable silent public DEFAULT channel', () => {
    expect(channelSource).toContain('REST_NOTIFICATION_CHANNEL_ID = "rest_timer"');
    expect(channelSource).toContain('NotificationManager.IMPORTANCE_DEFAULT');
    expect(channelSource).toContain('setSound(null, null)');
    expect(channelSource).toContain('enableVibration(false)');
    expect(channelSource).toContain('setShowBadge(false)');
    expect(channelSource).toContain('Notification.VISIBILITY_PUBLIC');
  });

  it('opens only the allowlisted active workout deep link with immutable flags', () => {
    expect(builderSource).toContain('"ajfit://workout/active"');
    expect(builderSource).toContain('Intent.ACTION_VIEW');
    expect(builderSource).toContain('PendingIntent.FLAG_UPDATE_CURRENT');
    expect(builderSource).toContain('PendingIntent.FLAG_IMMUTABLE');
  });

  it('ships a module-owned monochrome small icon', () => {
    expect(
      existsSync(
        'modules/ajfit-rest-activity/android/src/main/res/drawable/ic_ajfit_rest_notification.xml',
      ),
    ).toBe(true);
    expect(builderSource).toContain('R.drawable.ic_ajfit_rest_notification');
  });

  it('contains no background loop, service, alarm or API 36 live update', () => {
    for (const forbidden of [
      'ForegroundService',
      'startForeground(',
      'AlarmManager',
      'Handler',
      'postDelayed',
      'Timer(',
      'kotlinx.coroutines.delay',
      'Notification.ProgressStyle',
      'FLAG_PROMOTED_ONGOING',
      'canPostPromotedNotifications',
    ]) {
      expect(nativeSources).not.toContain(forbidden);
    }
  });
});
