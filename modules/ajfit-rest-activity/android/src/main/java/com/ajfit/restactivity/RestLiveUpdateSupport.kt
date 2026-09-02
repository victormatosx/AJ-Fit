package com.ajfit.restactivity

import android.annotation.TargetApi
import android.app.Notification
import android.app.NotificationManager
import android.os.Build

internal const val REST_LIVE_UPDATE_MIN_SDK = 36
internal const val POST_PROMOTED_NOTIFICATIONS_PERMISSION =
  "android.permission.POST_PROMOTED_NOTIFICATIONS"
internal const val REQUEST_PROMOTED_ONGOING_EXTRA = "android.requestPromotedOngoing"
internal const val REST_NOTIFICATION_PROMOTION_SETTINGS_ACTION =
  "android.settings.APP_NOTIFICATION_PROMOTION_SETTINGS"

internal enum class RestLiveSurface(val wireValue: String) {
  NONE("none"),
  NOTIFICATION("android-notification"),
  LIVE_UPDATE("android-live-update"),
}

/**
 * Pure capability decision kept independent from Expo and Android framework
 * objects. A promoted surface is an enhancement of a postable notification;
 * it can never turn a working ongoing notification into `none`.
 */
internal fun resolveRestLiveSurface(
  sdk: Int,
  notificationPermission: Boolean,
  promotionPermission: Boolean,
  promotable: Boolean,
): RestLiveSurface {
  if (!notificationPermission) return RestLiveSurface.NONE
  return if (
    sdk >= REST_LIVE_UPDATE_MIN_SDK &&
    promotionPermission &&
    promotable
  ) {
    RestLiveSurface.LIVE_UPDATE
  } else {
    RestLiveSurface.NOTIFICATION
  }
}

internal data class RestProgressSnapshot(
  val maximum: Int,
  val progress: Int,
)

/**
 * Materializes numeric ProgressStyle values only while a notification is
 * built. The temporal contract remains startedAt/endsAt and no ticking value
 * crosses the native bridge.
 */
internal fun calculateRestProgressSnapshot(
  startedAt: Long,
  endsAt: Long,
  now: Long,
): RestProgressSnapshot {
  val durationMillis = (endsAt - startedAt).coerceAtLeast(1L)
  val elapsedMillis = when {
    now <= startedAt -> 0L
    now >= endsAt -> durationMillis
    else -> now - startedAt
  }

  if (durationMillis <= Int.MAX_VALUE.toLong()) {
    return RestProgressSnapshot(
      maximum = durationMillis.toInt(),
      progress = elapsedMillis.toInt(),
    )
  }

  val scaledProgress =
    (elapsedMillis.toDouble() / durationMillis.toDouble() * Int.MAX_VALUE.toDouble())
      .toLong()
      .coerceIn(0L, Int.MAX_VALUE.toLong())
      .toInt()
  return RestProgressSnapshot(Int.MAX_VALUE, scaledProgress)
}

/**
 * Every API 36 symbol lives in this class so loading the module on API 24-35
 * never asks the verifier to resolve ProgressStyle or promoted APIs.
 */
@TargetApi(REST_LIVE_UPDATE_MIN_SDK)
internal object RestLiveUpdateApi36 {
  fun enrich(
    builder: Notification.Builder,
    contextTitle: String,
    contextShortCriticalText: String,
    state: RestActivityStateRecord,
    now: Long,
  ): Notification {
    val progress = calculateRestProgressSnapshot(state.startedAt, state.endsAt, now)
    val style = Notification.ProgressStyle()
      .setStyledByProgress(true)
      .setProgress(progress.progress)
      .addProgressSegment(Notification.ProgressStyle.Segment(progress.maximum))

    builder
      // SystemUI already owns app identity and the required small icon. Keep
      // the modern promoted presentation focused on rest + chronometer while
      // leaving the API 24-35 base notification completely unchanged.
      .setContentTitle(contextTitle)
      .setStyle(style)
      // This is deliberately static. The system chronometer remains the only
      // dynamic compact countdown; no per-second rebuild is introduced.
      .setShortCriticalText(contextShortCriticalText)

    // compileSdk 36 exposes promotion diagnostics but not the API 37 builder
    // convenience method. AndroidX Core 1.17 implements that method using this
    // exact documented extra, so this is the real SDK-36-compatible request.
    builder.extras.putBoolean(REQUEST_PROMOTED_ONGOING_EXTRA, true)
    return builder.build()
  }

  fun canPostPromotedNotifications(manager: NotificationManager): Boolean =
    manager.canPostPromotedNotifications()

  fun hasPromotableCharacteristics(notification: Notification): Boolean =
    notification.hasPromotableCharacteristics()

  fun hasPromotedOngoingFlag(notification: Notification): Boolean =
    notification.flags and Notification.FLAG_PROMOTED_ONGOING != 0
}

internal fun isLiveUpdateSdkSupported(): Boolean =
  Build.VERSION.SDK_INT >= REST_LIVE_UPDATE_MIN_SDK
