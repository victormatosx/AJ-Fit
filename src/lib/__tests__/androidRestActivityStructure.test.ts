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
const liveUpdateSource = readFileSync(
  'modules/ajfit-rest-activity/android/src/main/java/com/ajfit/restactivity/RestLiveUpdateSupport.kt',
  'utf8',
);
const manifestSource = readFileSync(
  'modules/ajfit-rest-activity/android/src/main/AndroidManifest.xml',
  'utf8',
);
const nativeSources = `${moduleSource}\n${builderSource}\n${channelSource}\n${liveUpdateSource}`;
const appConfig = JSON.parse(readFileSync('app.json', 'utf8')) as {
  expo: { android: { permissions?: string[] } };
};

describe('AJFitRestActivity Expo module', () => {
  it('keeps the Android module registered when the Apple module is added', () => {
    const config = JSON.parse(
      readFileSync('modules/ajfit-rest-activity/expo-module.config.json', 'utf8'),
    ) as {
      platforms: string[];
      apple: { modules: string[] };
      android: { modules: string[] };
    };

    expect(config.platforms).toEqual(['apple', 'android']);
    expect(config.apple.modules).toEqual(['AJFitRestActivityModule']);
    expect(config.android.modules).toEqual([
      'com.ajfit.restactivity.AJFitRestActivityModule',
    ]);
    expect(moduleSource).toContain('Name("AJFitRestActivity")');
    expect(moduleSource).toContain('Function("getCapabilities")');
    expect(moduleSource).toContain('AsyncFunction("start")');
    expect(moduleSource).toContain('AsyncFunction("update")');
    expect(moduleSource).toContain('AsyncFunction("end")');
    expect(moduleSource).toContain('AsyncFunction("cleanup")');
    expect(liveUpdateSource).toContain('"android-notification"');
    expect(liveUpdateSource).toContain('"android-live-update"');
  });

  it('declares POST_NOTIFICATIONS through Expo app config', () => {
    expect(appConfig.expo.android.permissions).toContain(
      'android.permission.POST_NOTIFICATIONS',
    );
    expect(moduleSource).toContain('Manifest.permission.POST_NOTIFICATIONS');
    expect(moduleSource).toContain('permissions.askForPermissions(');
    expect(moduleSource).toContain('PERMISSION_REQUESTED_KEY');
  });

  it('declares promoted notifications as a module-owned non-runtime permission', () => {
    expect(manifestSource).toContain(
      'android.permission.POST_PROMOTED_NOTIFICATIONS',
    );
    expect(liveUpdateSource).toContain(
      'POST_PROMOTED_NOTIFICATIONS_PERMISSION',
    );
    expect(moduleSource).not.toContain('askForPermissions(\n        POST_PROMOTED');
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
    expect(moduleSource.match(/AsyncFunction\("cleanup"\)/g)).toHaveLength(1);
  });

  it('keeps only production transition/fallback diagnostics', () => {
    for (const marker of [
      'started',
      'updated',
      'ended',
      'fallback',
      'native_error',
      'permission_denied',
    ]) {
      expect(nativeSources).toContain(marker);
    }
    for (const verboseMarker of [
      'module_available',
      'permission_state',
      'notification_build',
      'notify_called',
      'active_notification_found',
      'live_update_sdk_supported',
      'live_update_promotable',
    ]) expect(nativeSources).not.toContain(verboseMarker);
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

  it('contains no background loop, service, alarm or custom overlay', () => {
    for (const forbidden of [
      'ForegroundService',
      'startForeground(',
      'FOREGROUND_SERVICE',
      'AlarmManager',
      'SYSTEM_ALERT_WINDOW',
      'WindowManager.LayoutParams',
      'TYPE_APPLICATION_OVERLAY',
      'Handler',
      'postDelayed',
      'Timer(',
      'kotlinx.coroutines.delay',
    ]) {
      expect(nativeSources).not.toContain(forbidden);
    }
  });

  it('isolates every modern notification API behind an explicit API 36 guard', () => {
    expect(liveUpdateSource).toContain('REST_LIVE_UPDATE_MIN_SDK = 36');
    expect(liveUpdateSource).toContain(
      'Build.VERSION.SDK_INT >= REST_LIVE_UPDATE_MIN_SDK',
    );
    expect(liveUpdateSource).toContain(
      '@TargetApi(REST_LIVE_UPDATE_MIN_SDK)',
    );
    expect(builderSource).toContain('if (!isLiveUpdateSdkSupported())');

    for (const api of [
      'Notification.ProgressStyle()',
      'Notification.ProgressStyle.Segment(',
      'setShortCriticalText(',
      'hasPromotableCharacteristics()',
      'canPostPromotedNotifications()',
      'Notification.FLAG_PROMOTED_ONGOING',
    ]) {
      expect(liveUpdateSource).toContain(api);
    }
  });

  it('requests promotion without forcing the system-owned promoted flag', () => {
    expect(liveUpdateSource).toContain(
      'REQUEST_PROMOTED_ONGOING_EXTRA = "android.requestPromotedOngoing"',
    );
    expect(liveUpdateSource).toContain(
      'builder.extras.putBoolean(REQUEST_PROMOTED_ONGOING_EXTRA, true)',
    );
    expect(liveUpdateSource).not.toContain(
      'setFlag(Notification.FLAG_PROMOTED_ONGOING',
    );
  });

  it('derives ProgressStyle once from absolute timestamps and keeps the system chronometer', () => {
    expect(liveUpdateSource).toContain('calculateRestProgressSnapshot(');
    expect(liveUpdateSource).toContain('startedAt: Long');
    expect(liveUpdateSource).toContain('endsAt: Long');
    expect(liveUpdateSource).toContain('now: Long');
    expect(liveUpdateSource).toContain('.setProgress(progress.progress)');
    expect(liveUpdateSource).toContain(
      'Notification.ProgressStyle.Segment(progress.maximum)',
    );
    expect(nativeSources).not.toContain('remainingSeconds');
    expect(builderSource).toContain('setWhen(state.endsAt)');
    expect(builderSource).toContain('setUsesChronometer(true)');
    expect(builderSource).toContain('setChronometerCountDown(true)');
  });

  it('removes large branding only from the API 36 promoted presentation', () => {
    expect(builderSource).toContain(
      'setContentTitle(context.getString(R.string.ajfit_rest_notification_title))',
    );
    expect(builderSource).toContain(
      'contextTitle = context.getString(R.string.ajfit_rest_live_update_title)',
    );
    expect(liveUpdateSource).toContain('.setContentTitle(contextTitle)');
    expect(liveUpdateSource).toContain(
      '.setShortCriticalText(contextShortCriticalText)',
    );
    expect(liveUpdateSource).not.toContain('remainingSeconds');
  });

  it('keeps promotion optional in the pure surface resolver', () => {
    const resolver = liveUpdateSource.slice(
      liveUpdateSource.indexOf('internal fun resolveRestLiveSurface('),
      liveUpdateSource.indexOf('internal data class RestProgressSnapshot'),
    );
    expect(resolver).toContain(
      'if (!notificationPermission) return RestLiveSurface.NONE',
    );
    expect(resolver).toContain('sdk >= REST_LIVE_UPDATE_MIN_SDK');
    expect(resolver).toContain('promotionPermission');
    expect(resolver).toContain('promotable');
    expect(resolver).toContain('RestLiveSurface.LIVE_UPDATE');
    expect(resolver).toContain('RestLiveSurface.NOTIFICATION');
    expect(moduleSource).toContain('"promotion_denied"');
    expect(moduleSource).toContain('"not_promotable"');
  });

  it('prepares but never opens the optional system promotion settings screen', () => {
    expect(liveUpdateSource).toContain(
      'android.settings.APP_NOTIFICATION_PROMOTION_SETTINGS',
    );
    expect(nativeSources).not.toContain('startActivity(');
  });
});
